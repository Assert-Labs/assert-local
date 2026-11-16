import type { CliConfiguration } from './config.js'
import { fetchWithDiagnostics } from './fetch.js'

export interface AssertUser {
  id: string
  name: string
  email: string
  image?: string | null
}

export interface AssertSession {
  token: string
  user: AssertUser
  githubUser: {
    id: string
    login: string
  }
  workspace: {
    id: string
    name: string
    slug: string
  }
}

export class SessionEndedError extends Error {
  constructor() {
    super(
      'Your Assert session has ended. Run `assert-local login`, then try again.',
    )
  }
}

/** The gh account isn't the GitHub account linked to the signed-in Assert user */
export class GithubAccountMismatchError extends Error {
  constructor(readonly login: string) {
    super(
      `GitHub @${login} is not the GitHub account linked to your Assert account.`,
    )
  }
}

const UNEXPECTED_RESPONSE =
  'Assert returned an unexpected response. Try again, or update with `npx assert-local@latest`. If it continues, contact support@assert.dev.'

function authorizedFetch(
  configuration: CliConfiguration,
  token: string,
  path: string,
  init: RequestInit,
  operation: string,
) {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  return fetchWithDiagnostics(
    new URL(path, configuration.apiUrl),
    {
      ...init,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    },
    operation,
  )
}

async function failedResponse(response: Response, operation: string) {
  await response.body?.cancel()
  return new Error(
    `${operation} failed (HTTP ${response.status}). Try again later. If it continues, contact support@assert.dev.`,
  )
}

/** The session's user, or undefined when the session has ended */
export async function getSessionUser(
  configuration: CliConfiguration,
  token: string,
): Promise<AssertUser | undefined> {
  const response = await authorizedFetch(
    configuration,
    token,
    '/api/auth/get-session',
    {},
    'Checking your Assert session',
  )
  if (response.status === 401) {
    await response.body?.cancel()
    return undefined
  }
  if (!response.ok) {
    throw await failedResponse(response, 'Checking your Assert session')
  }
  // Better Auth reports an expired or revoked session as 200 with a null body.
  const body = (await response.json().catch(() => undefined)) as
    { user?: Partial<AssertUser> } | null | undefined
  if (body === null) return undefined
  const user = body?.user
  if (
    typeof user?.id !== 'string' ||
    typeof user.name !== 'string' ||
    typeof user.email !== 'string'
  ) {
    throw new Error(UNEXPECTED_RESPONSE)
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
  }
}

/** Lets Assert use the GitHub CLI's credential for repositories it can't otherwise reach. */
export async function attachGithubCredential(
  configuration: CliConfiguration,
  token: string,
  githubToken: string,
) {
  const response = await authorizedFetch(
    configuration,
    token,
    '/api/github/session-credential',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: githubToken }),
    },
    'Connecting the GitHub CLI',
  )
  if (response.status === 401) {
    await response.body?.cancel()
    throw new SessionEndedError()
  }
  if (!response.ok) {
    throw await failedResponse(response, 'Connecting the GitHub CLI')
  }
  const body = (await response.json().catch(() => undefined)) as
    { status?: unknown; login?: unknown } | undefined
  if (body?.status === 'rejected') {
    throw new Error(
      'GitHub did not accept your GitHub CLI credentials. Run `gh auth login`, then try again.',
    )
  }
  if (typeof body?.login !== 'string') throw new Error(UNEXPECTED_RESPONSE)
  if (body.status === 'account-mismatch') {
    throw new GithubAccountMismatchError(body.login)
  }
  if (body.status !== 'attached') throw new Error(UNEXPECTED_RESPONSE)
  return { login: body.login }
}

export async function getPersonalWorkspace(
  configuration: CliConfiguration,
  token: string,
  userId: string,
) {
  const response = await authorizedFetch(
    configuration,
    token,
    '/api/auth/organization/list',
    {},
    'Loading your Assert workspace',
  )
  if (response.status === 401) {
    await response.body?.cancel()
    throw new SessionEndedError()
  }
  if (!response.ok) {
    throw await failedResponse(response, 'Loading your Assert workspace')
  }
  const workspaces = (await response.json().catch(() => undefined)) as unknown
  if (!Array.isArray(workspaces)) throw new Error(UNEXPECTED_RESPONSE)
  const workspace = (
    workspaces as {
      id?: unknown
      name?: unknown
      slug?: unknown
      personalOwnerUserId?: unknown
    }[]
  ).find((workspace) => workspace?.personalOwnerUserId === userId)
  if (
    typeof workspace?.id !== 'string' ||
    typeof workspace.name !== 'string' ||
    typeof workspace.slug !== 'string'
  ) {
    throw new Error(
      `Your Assert account has no personal workspace. Open ${configuration.webUrl} once, then try again.`,
    )
  }
  return { id: workspace.id, name: workspace.name, slug: workspace.slug }
}

export async function revokeSession(
  configuration: CliConfiguration,
  token: string,
) {
  const response = await authorizedFetch(
    configuration,
    token,
    '/api/auth/sign-out',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
    'Signing out of Assert',
  )
  await response.body?.cancel()
}

export function createAssertClient(
  configuration: CliConfiguration,
  session: AssertSession,
) {
  const lifetime = new AbortController()

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
      const headers = new Headers(init.headers)
      headers.set('authorization', `Bearer ${session.token}`)
      const response = await fetchWithDiagnostics(
        url,
        {
          ...init,
          headers,
          redirect: 'manual',
          signal: AbortSignal.any([
            lifetime.signal,
            AbortSignal.timeout(120_000),
            ...(init.signal == null ? [] : [init.signal]),
          ]),
        },
        'Connecting to Assert',
      )
      const ended =
        url.pathname === '/api/auth/get-session'
          ? response.status === 401 ||
            // Better Auth reports an ended session as 200 with a null body
            (response.ok && (await response.clone().json()) == null)
          : response.status === 401 &&
            // Assert also answers 401 for repositories the user can't access
            (await getSessionUser(configuration, session.token)) == null
      if (!ended) return response
      await response.body?.cancel()
      throw new SessionEndedError()
    },
    close: () => lifetime.abort(),
  }
}
