import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachGithubCredential,
  createAssertClient,
  getPersonalWorkspace,
  getSessionUser,
  GithubAccountMismatchError,
  SessionEndedError,
  type AssertSession,
} from '../assert-api.js'

const configuration = {
  apiUrl: 'https://api.assert.dev',
  webUrl: 'https://app.assert.dev',
}
const session: AssertSession = {
  token: 'session-token',
  user: { id: 'user', name: 'User', email: 'user@example.com' },
  githubUser: { id: '1', login: 'user' },
  workspace: { id: 'workspace', name: 'User', slug: '@user' },
}

afterEach(() => vi.unstubAllGlobals())

describe('session lookup', () => {
  it.each([
    ['a null session', () => new Response('null')],
    ['a 401', () => new Response(null, { status: 401 })],
  ])('treats %s as signed out', async (_name, response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    expect(await getSessionUser(configuration, 'token')).toBeUndefined()
  })

  it('returns the session user', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ user: session.user, session: {} }))
    vi.stubGlobal('fetch', fetch)
    expect(await getSessionUser(configuration, 'token')).toEqual(session.user)
    expect(fetch.mock.calls[0]?.[1].headers.get('authorization')).toBe(
      'Bearer token',
    )
    expect(fetch.mock.calls[0]?.[1].redirect).toBe('manual')
  })
})

describe('GitHub CLI credential', () => {
  it('reports a gh account that is not linked to the Assert user', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ status: 'account-mismatch', login: 'other' }),
        ),
    )
    const error = await attachGithubCredential(
      configuration,
      'token',
      'gh-token',
    ).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(GithubAccountMismatchError)
    expect((error as GithubAccountMismatchError).login).toBe('other')
  })

  it('asks for a new gh login when GitHub rejects the credential', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ status: 'rejected' })),
    )
    await expect(
      attachGithubCredential(configuration, 'token', 'gh-token'),
    ).rejects.toThrow('gh auth login')
  })
})

it('finds the personal workspace among team workspaces', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json([
        { id: 'team', name: 'Team', slug: 'team' },
        {
          id: 'personal',
          name: 'User',
          slug: '@user',
          personalOwnerUserId: 'user',
        },
      ]),
    ),
  )
  expect(await getPersonalWorkspace(configuration, 'token', 'user')).toEqual({
    id: 'personal',
    name: 'User',
    slug: '@user',
  })
})

describe('Assert API client', () => {
  it('passes through a 401 for a repository while the session is valid', async () => {
    const fetch = vi.fn((url: URL) =>
      Promise.resolve(
        url.pathname === '/api/auth/get-session'
          ? Response.json({ user: session.user })
          : new Response(null, { status: 401 }),
      ),
    )
    vi.stubGlobal('fetch', fetch)
    const client = createAssertClient(configuration, session)
    expect((await client.request('/api/repo')).status).toBe(401)
    client.close()
  })

  it.each(['/api/repo', '/api/auth/get-session'])(
    'reports an ended session from %s',
    async (path) => {
      const fetch = vi.fn((url: URL) =>
        Promise.resolve(
          url.pathname === '/api/auth/get-session'
            ? new Response('null')
            : new Response(null, { status: 401 }),
        ),
      )
      vi.stubGlobal('fetch', fetch)
      const client = createAssertClient(configuration, session)
      await expect(client.request(path)).rejects.toBeInstanceOf(
        SessionEndedError,
      )
      client.close()
    },
  )

  it('never sends credentials to another origin or follows redirects', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302 }))
    vi.stubGlobal('fetch', fetch)
    const client = createAssertClient(configuration, session)
    await expect(client.request('//example.com/api/test')).rejects.toThrow(
      'configured API origin',
    )
    await expect(client.request('/not-api')).rejects.toThrow(
      'configured API origin',
    )
    expect(fetch).not.toHaveBeenCalled()
    await client.request('/api/test')
    expect(fetch.mock.calls[0]?.[1].redirect).toBe('manual')
    client.close()
  })
})
