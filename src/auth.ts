import open from 'open'
import {
  attachGithubCredential,
  getPersonalWorkspace,
  getSessionUser,
  type AssertSession,
} from './assert-api.js'
import type { CliConfiguration } from './config.js'
import { getGhToken, getGithubUser } from './gh.js'
import {
  forgetSessionToken,
  getStoredSessionToken,
  storeSessionToken,
} from './session-store.js'
import { signInWithBrowser } from './sign-in.js'

async function openBrowser(url: string) {
  const browser = await open(url)
  browser.once('error', () => {})
}

/**
 * Reuses the saved Assert session, signing in through the browser when there
 * is none and `interactive` allows it, then connects the GitHub CLI account.
 */
export async function authenticate({
  configuration,
  interactive,
}: {
  configuration: CliConfiguration
  interactive: boolean
}): Promise<AssertSession> {
  const { apiUrl } = configuration
  let token = await getStoredSessionToken(apiUrl)
  let user =
    token == null ? undefined : await getSessionUser(configuration, token)
  if (token == null || user == null) {
    if (token != null) await forgetSessionToken(apiUrl)
    if (!interactive) {
      throw new Error('Sign in to Assert first: run `assert-local login`.')
    }
    token = (await signInWithBrowser(configuration, openBrowser)).token
    user = await getSessionUser(configuration, token)
    if (user == null) {
      throw new Error('Assert sign-in did not complete. Run the command again.')
    }
    await storeSessionToken(apiUrl, token)
  }

  const githubUser = await getGithubUser()
  await attachGithubCredential(configuration, token, await getGhToken())
  const workspace = await getPersonalWorkspace(configuration, token, user.id)
  return {
    token,
    user,
    githubUser: { id: String(githubUser.id), login: githubUser.login },
    workspace,
  }
}
