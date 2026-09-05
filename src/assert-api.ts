import type { CliConfiguration } from './config.js'
import { fetchWithDiagnostics } from './fetch.js'

export interface AssertSession {
  token: string
  expiresAt: string
  user: {
    id: string
    name: string
    email: string
    image?: string | null
  }
  githubUser: {
    id: string
    login: string
    name?: string
    image?: string
  }
  workspace: {
    id: string
    name: string
    slug: string
  }
}

export class AssertAccountNotFoundError extends Error {}

async function responseMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: unknown }
    return body != null && typeof body.message === 'string'
      ? body.message
      : undefined
  } catch {
    return undefined
  }
}

export async function exchangeGithubToken(
  configuration: CliConfiguration,
  githubToken: string,
  signal?: AbortSignal,
) {
  const response = await fetchWithDiagnostics(
    new URL('/api/auth/cli/exchange', configuration.apiUrl),
    {
      method: 'POST',
      headers: {
        authorization: `token ${githubToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ providerId: 'github' }),
      redirect: 'manual',
      signal: AbortSignal.any([
        AbortSignal.timeout(30_000),
        ...(signal == null ? [] : [signal]),
      ]),
    },
    'Assert sign-in',
  )
  if (response.status === 404) {
    if (
      (await responseMessage(response)) ===
      'No Assert account is linked to this GitHub account.'
    ) {
      throw new AssertAccountNotFoundError(
        'No Assert account is linked to this GitHub user.',
      )
    }
    throw new Error(
      `Assert sign-in at ${configuration.apiUrl} returned HTTP 404. This server may not support Assert Local yet. Check ASSERT_API_URL and that the token-exchange endpoint is deployed.`,
    )
  }
  if (!response.ok) {
    await response.body?.cancel()
    const hint =
      response.status >= 300 && response.status < 400
        ? 'The API redirected the request. Check ASSERT_API_URL and any access gateway; use the API origin, not the website.'
        : response.status === 401
          ? 'Authentication was rejected. Check the active account with `gh auth status` and any API access restrictions.'
          : response.status === 403
            ? 'Access was denied. Check the API access restrictions and your GitHub account permissions.'
            : response.status === 409
              ? 'The GitHub account could not be matched to a unique Assert account with a personal workspace. Sign in to the Assert app or contact support.'
              : response.status === 429
                ? 'The server is rate limiting requests. Wait before trying again.'
                : 'Check service availability and that the server supports Assert Local, then retry.'
    throw new Error(
      `Assert sign-in at ${configuration.apiUrl} returned HTTP ${response.status}. ${hint}`,
    )
  }
  try {
    const session = (await response.json()) as AssertSession
    if (
      typeof session?.token !== 'string' ||
      !session.token ||
      typeof session.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(session.expiresAt)) ||
      typeof session.user?.id !== 'string' ||
      typeof session.githubUser?.id !== 'string' ||
      typeof session.githubUser.login !== 'string' ||
      typeof session.workspace?.id !== 'string'
    ) {
      throw new Error('Invalid session response')
    }
    return session
  } catch {
    throw new Error(
      `Assert sign-in at ${configuration.apiUrl} returned an invalid response (HTTP ${response.status}). Check ASSERT_API_URL points to an API server that supports Assert Local, not a website or sign-in gateway.`,
    )
  }
}

export function createAssertClient(
  configuration: CliConfiguration,
  initialSession: AssertSession,
  exchange: (signal: AbortSignal) => Promise<AssertSession>,
) {
  let session = initialSession
  let refreshing: Promise<AssertSession> | undefined
  const lifetime = new AbortController()

  async function refresh(rejectedToken = session.token) {
    lifetime.signal.throwIfAborted()
    // A late 401 for the previous token must not mint another session.
    if (session.token !== rejectedToken) return session
    refreshing ??= exchange(lifetime.signal)
      .then((next) => {
        if (
          next.user.id !== initialSession.user.id ||
          next.githubUser.id !== initialSession.githubUser.id ||
          next.workspace.id !== initialSession.workspace.id
        ) {
          throw new Error(
            'The active account or workspace changed. Stop the server and run `assert-local review` again.',
          )
        }
        session = next
        return next
      })
      .finally(() => {
        refreshing = undefined
      })
    return refreshing
  }

  return {
    async request(path: string, init: RequestInit = {}) {
      const url = new URL(path, configuration.apiUrl)
      if (
        url.origin !== configuration.apiUrl ||
        !url.pathname.startsWith('/api/')
      ) {
        throw new Error(
          'Assert API requests must stay on the configured API origin',
        )
      }
      if (Date.parse(session.expiresAt) <= Date.now() + 30_000) await refresh()
      const headers = new Headers(init.headers)
      const signal = AbortSignal.any([
        lifetime.signal,
        AbortSignal.timeout(120_000),
        ...(init.signal == null ? [] : [init.signal]),
      ])
      const send = (token: string) => {
        headers.set('authorization', `Bearer ${token}`)
        return fetchWithDiagnostics(
          url,
          { ...init, headers, signal, redirect: 'manual' },
          'Assert API request',
        )
      }
      const token = session.token
      const response = await send(token)
      // Better Auth reports an expired or revoked session as 200 with a null body.
      const missingSession =
        url.pathname === '/api/auth/get-session' &&
        response.ok &&
        (await response.clone().json()) == null
      if (response.status !== 401 && !missingSession) return response
      await response.body?.cancel()
      return send((await refresh(token)).token)
    },
    close: () => lifetime.abort(),
  }
}
