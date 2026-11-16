import { GithubAccountMismatchError, revokeSession } from '../assert-api.js'
import { authenticate } from '../auth.js'
import { getConfiguration } from '../config.js'
import { forgetSessionToken, getStoredSessionToken } from '../session-store.js'
import { ensureGh } from './review.js'

export async function loginCommand() {
  const configuration = getConfiguration()
  if (!(await ensureGh())) return
  try {
    const session = await authenticate({ configuration, interactive: true })
    console.log(
      `GitHub: @${session.githubUser.login}\nAssert: ${session.user.name} <${session.user.email}>`,
    )
  } catch (error) {
    if (!(error instanceof GithubAccountMismatchError)) throw error
    throw new Error(
      `${error.message} Run \`gh auth switch\` to use that account, or \`assert-local logout\` and sign in to a different Assert account.`,
    )
  }
}

export async function logoutCommand() {
  const configuration = getConfiguration()
  const token = await getStoredSessionToken(configuration.apiUrl)
  if (token != null) {
    try {
      await revokeSession(configuration, token)
    } catch {
      // Forgetting the token locally still signs this CLI out
    }
    await forgetSessionToken(configuration.apiUrl)
  }
  console.log('Signed out of Assert.')
}
