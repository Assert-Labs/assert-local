import { confirm, select } from '@inquirer/prompts'
import { emitKeypressEvents } from 'node:readline'
import open from 'open'
import {
  GithubAccountMismatchError,
  type AssertSession,
} from '../assert-api.js'
import { authenticate } from '../auth.js'
import { getConfiguration, type CliConfiguration } from '../config.js'
import {
  getRepository,
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
import { parseReviewTarget } from '../review-target.js'
import { formatWordmark } from '../wordmark.js'

async function authenticateInteractively(
  configuration: CliConfiguration,
): Promise<AssertSession | undefined> {
  for (;;) {
    try {
      return await authenticate({ configuration, interactive: true })
    } catch (error) {
      if (!(error instanceof GithubAccountMismatchError)) throw error
      const action = await select({
        message: error.message,
        choices: [
          {
            name: 'Switch the active gh account',
            value: 'switch' as const,
          },
          { name: 'Cancel', value: 'cancel' as const },
        ],
      })
      if (action === 'cancel') {
        console.log(
          'To use a different Assert account, run `assert-local logout`, sign in to that account in your browser, and run `assert-local review` again.',
        )
        return undefined
      }
      await switchGhAccount()
    }
  }
}

export async function ensureGh() {
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

export async function reviewCommand(
  options: { open: boolean },
  target?: string,
) {
  const reviewTarget = target == null ? undefined : parseReviewTarget(target)
  const configuration = getConfiguration()
  console.log(`
${formatWordmark()}

Review code in your browser using the full power of Assert's AI-assisted diffs.
This CLI signs in to Assert in your browser and uses your GitHub CLI account to
choose a repository.
`)
  if (!(await ensureGh())) return

  const session = await authenticateInteractively(configuration)
  if (session == null) return
  const { githubUser } = session

  console.log(
    `\nGitHub: @${githubUser.login}\nAssert: ${session.user.name} <${session.user.email}>`,
  )
  const identity = {
    apiUrl: configuration.apiUrl,
    githubUserId: Number(githubUser.id),
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
    githubUserId: Number(githubUser.id),
  }
  const repository = reviewTarget
    ? await getRepository(reviewTarget.repository)
    : await chooseRepository({
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
    pullNumber: reviewTarget?.pullNumber,
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
  await new Promise<void>((resolve) => {
    let stopping = false
    const input = process.stdin
    const previousRawMode = input.isRaw
    const warnBrowserFailure = () => {
      if (stopping) return
      console.error(
        `Could not open your browser. The server is still running; open ${localServer.launchUrl} manually.`,
      )
    }
    const openReview = async () => {
      try {
        const browser = await open(localServer.launchUrl)
        browser.once('error', warnBrowserFailure)
        browser.once('exit', (code) => {
          if (code != null && code !== 0) warnBrowserFailure()
        })
      } catch {
        warnBrowserFailure()
      }
    }

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
        void openReview()
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
    if (options.open) void openReview()
  })
}
