import type { CliConfiguration } from './config.js'

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
    return typeof body.message === 'string' ? body.message : undefined
  } catch {
    return undefined
  }
}

export async function exchangeGithubToken(
  configuration: CliConfiguration,
  githubToken: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    new URL('/api/auth/cli/exchange', configuration.apiUrl),
    {
      method: 'POST',
      headers: {
        authorization: `token ${githubToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ providerId: 'github' }),
      signal: AbortSignal.any([
        AbortSignal.timeout(30_000),
        ...(signal == null ? [] : [signal]),
      ]),
    },
  )
  if (response.status === 404) {
    throw new AssertAccountNotFoundError(
      'No Assert account is linked to this GitHub user.',
    )
  }
  if (!response.ok) {
    throw new Error(
      (await responseMessage(response)) ??
        `Assert authentication failed (${response.status})`,
    )
  }
  return (await response.json()) as AssertSession
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
        return fetch(url, { ...init, headers, signal, redirect: 'manual' })
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
