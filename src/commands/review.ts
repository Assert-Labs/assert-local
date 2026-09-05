import { confirm, select } from '@inquirer/prompts'
import { emitKeypressEvents } from 'node:readline'
import open from 'open'
import {
  AssertAccountNotFoundError,
  exchangeGithubToken,
} from '../assert-api.js'
import { getConfiguration, type CliConfiguration } from '../config.js'
import {
  getGithubUser,
  getGhToken,
  isGhAuthenticated,
  isGhInstalled,
  loginGh,
  switchGhAccount,
} from '../gh.js'
import { startLocalServer } from '../local-server.js'
import {
  getRecentRepository,
  isIdentityAuthorized,
  rememberIdentityAuthorization,
  rememberRepository,
} from '../preferences.js'
import { chooseRepository } from '../repositories.js'
async function authenticate(configuration: CliConfiguration) {
  for (;;) {
    const githubUser = await getGithubUser()
    const githubToken = await getGhToken()
    try {
      const session = await exchangeGithubToken(configuration, githubToken)
      if (session.githubUser.id !== String(githubUser.id)) {
        throw new Error(
          'The active gh account changed during setup. Run `assert-local review` again.',
        )
      }
      return { githubUser, session }
    } catch (error) {
      if (!(error instanceof AssertAccountNotFoundError)) throw error

      const action = await select({
        message: `GitHub @${githubUser.login} is not linked to an Assert account`,
        choices: [
          {
            name: 'Sign up for Assert with GitHub',
            value: 'signup' as const,
          },
          {
            name: 'Switch the active gh account',
            value: 'switch' as const,
          },
          { name: 'Cancel', value: 'cancel' as const },
        ],
      })
      if (action === 'signup') {
        await open(new URL('/signup', configuration.webUrl).toString())
        console.log(
          'Sign up with GitHub, then run `assert-local review` again.',
        )
        return undefined
      }
      if (action === 'cancel') return undefined
      await switchGhAccount()
    }
  }
}

async function ensureGh() {
  if (!(await isGhInstalled())) {
    throw new Error(
      'GitHub CLI is required. Install it from https://cli.github.com/ and run this command again.',
    )
  }
  if (await isGhAuthenticated()) return true
  if (!process.stdin.isTTY) {
    throw new Error('GitHub CLI is not logged in. Run `gh auth login` first.')
  }
  const shouldLogin = await confirm({
    message: 'GitHub CLI is not logged in. Log in now?',
    default: true,
  })
  if (!shouldLogin) return false
  await loginGh()
  return isGhAuthenticated()
}

export async function reviewCommand(options: { open: boolean }) {
  const configuration = getConfiguration()
  console.log(`
Assert Local — Move fast, don't break things

Review code in your browser the full power of Assert's AI-assisted diffs.
This CLI uses your GitHub CLI account to connect to Assert and choose a repository.

You’ll need an Assert account linked to GitHub.
`)
  if (!(await ensureGh())) return

  const authenticated = await authenticate(configuration)
  if (authenticated == null) return
  const { githubUser, session } = authenticated

  console.log(
    `\nGitHub: @${githubUser.login}\nAssert: ${session.user.name} <${session.user.email}>`,
  )
  const identity = {
    apiUrl: configuration.apiUrl,
    githubUserId: githubUser.id,
    assertUserId: session.user.id,
  }
  if (!(await isIdentityAuthorized(identity))) {
    const proceed = await confirm({
      message: 'Continue with this identity?',
      default: true,
    })
    if (!proceed) return
    await rememberIdentityAuthorization(identity)
  }

  const repositoryPreference = {
    apiUrl: configuration.apiUrl,
    githubUserId: githubUser.id,
  }
  const repository = await chooseRepository({
    githubLogin: githubUser.login,
    recentRepository: await getRecentRepository(repositoryPreference),
  })
  const separator = repository.nameWithOwner.indexOf('/')
  const selectedRepository = {
    owner: repository.nameWithOwner.slice(0, separator),
    repo: repository.nameWithOwner.slice(separator + 1),
  }
  if (!selectedRepository.owner || !selectedRepository.repo) {
    throw new Error(`Invalid GitHub repository: ${repository.nameWithOwner}`)
  }

  await rememberRepository({
    ...repositoryPreference,
    nameWithOwner: repository.nameWithOwner,
  })

  const localServer = await startLocalServer({
    configuration,
    session,
    repository: selectedRepository,
    refreshSession: async (signal) =>
      exchangeGithubToken(configuration, await getGhToken(signal), signal),
    onWarmError: (error) => {
      console.error(
        `Assert Local could not warm the inbox and will retry: ${error instanceof Error ? error.message : String(error)}`,
      )
    },
  })
  console.log(`\nAssert Local is reviewing ${repository.nameWithOwner}`)
  console.log('Warming inbox reviews while this server is running.')
  console.log(`Open ${localServer.launchUrl}`)
  console.log(
    process.stdin.isTTY
      ? 'Press o to reopen the page, or Ctrl+C to stop.'
      : 'Press Ctrl+C to stop.',
  )
  if (options.open) await open(localServer.launchUrl)

  await new Promise<void>((resolve) => {
    let stopping = false
    const input = process.stdin
    const previousRawMode = input.isRaw

    const cleanup = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      input.off('keypress', onKeypress)
      if (input.isTTY) {
        input.setRawMode(previousRawMode ?? false)
        input.pause()
      }
    }
    const stop = () => {
      if (stopping) return
      stopping = true
      cleanup()
      localServer.close().then(resolve, resolve)
    }
    const onKeypress = (
      _value: string,
      key: { ctrl?: boolean; name?: string },
    ) => {
      if (key.ctrl && key.name === 'c') {
        stop()
      } else if (key.name === 'o') {
        void open(localServer.launchUrl).catch((error: unknown) => {
          console.error(error instanceof Error ? error.message : String(error))
        })
      }
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    if (input.isTTY) {
      emitKeypressEvents(input)
      input.setRawMode(true)
      input.resume()
      input.on('keypress', onKeypress)
    }
  })
}
