import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AssertAccountNotFoundError,
  createAssertClient,
  exchangeGithubToken,
  type AssertSession,
} from '../assert-api.js'

const configuration = {
  apiUrl: 'https://api.assert.dev',
  webUrl: 'https://app.assert.dev',
}
const session: AssertSession = {
  token: 'old',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: 'user', name: 'User', email: 'user@example.com' },
  githubUser: { id: '1', login: 'user' },
  workspace: { id: 'workspace', name: 'User', slug: '@user' },
}

afterEach(() => vi.unstubAllGlobals())

describe('token exchange', () => {
  it('only offers signup when the API explicitly reports an unlinked account', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { message: 'No Assert account is linked to this GitHub account.' },
            { status: 404 },
          ),
        ),
    )
    await expect(
      exchangeGithubToken(configuration, 'test-token'),
    ).rejects.toBeInstanceOf(AssertAccountNotFoundError)
  })

  it.each(['', '<html>Not found</html>', '{"message":"Route not found"}'])(
    'reports an unavailable endpoint rather than offering signup for a generic 404',
    async (body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(body, { status: 404 })),
      )
      const error = await exchangeGithubToken(
        configuration,
        'test-token',
      ).catch((error: unknown) => error)
      expect(error).not.toBeInstanceOf(AssertAccountNotFoundError)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('HTTP 404')
      expect((error as Error).message).toContain(
        'This may be a service issue or an outdated CLI',
      )
    },
  )

  it('reports HTTP failures without echoing an untrusted response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ message: 'secret-from-upstream' }, { status: 403 }),
        ),
    )
    await expect(
      exchangeGithubToken(configuration, 'test-token'),
    ).rejects.toThrow(
      'Assert sign-in failed (HTTP 403). Access was denied. Make sure your GitHub account has access to Assert. If it continues, contact support@assert.dev.',
    )
  })

  it('does not follow sign-in redirects with the GitHub token', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://gateway.example.com/login' },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    await expect(
      exchangeGithubToken(configuration, 'test-token'),
    ).rejects.toThrow('Sign-in was unexpectedly redirected')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[1].redirect).toBe('manual')
  })

  it.each(['<html>Sign in</html>', 'null', '{}'])(
    'reports an incompatible response before setup can crash',
    async (body) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
      await expect(
        exchangeGithubToken(configuration, 'test-token'),
      ).rejects.toThrow('unexpected response (HTTP 200)')
    },
  )

  it('accepts a valid matched session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(session)))
    expect(await exchangeGithubToken(configuration, 'test-token')).toEqual(
      session,
    )
  })
})

describe('Assert API client', () => {
  it('refreshes when Better Auth returns a null session instead of a 401', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('null'))
      .mockResolvedValueOnce(new Response('{"user":{"id":"user"}}'))
    vi.stubGlobal('fetch', fetch)
    const exchange = vi.fn().mockResolvedValue({ ...session, token: 'new' })
    const client = createAssertClient(configuration, session, exchange)
    expect(
      await (await client.request('/api/auth/get-session')).json(),
    ).toEqual({ user: { id: 'user' } })
    expect(exchange).toHaveBeenCalledTimes(1)
    client.close()
  })

  it('shares refresh across concurrent requests and late 401 responses', async () => {
    let releaseLateResponse!: (response: Response) => void
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseLateResponse = resolve
          }),
      )
      .mockImplementation(() => Promise.resolve(new Response('{}')))
    vi.stubGlobal('fetch', fetch)
    const exchange = vi.fn().mockResolvedValue({ ...session, token: 'new' })
    const client = createAssertClient(configuration, session, exchange)
    const first = client.request('/api/one')
    const second = client.request('/api/two')
    await first
    releaseLateResponse(new Response(null, { status: 401 }))
    await second
    expect(exchange).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(4)
    client.close()
  })

  it.each(['user', 'githubUser', 'workspace'] as const)(
    'rejects a changed %s during refresh',
    async (field) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 401 }))
      vi.stubGlobal('fetch', fetch)
      const next = {
        ...session,
        [field]: { ...session[field], id: 'different' },
      }
      const client = createAssertClient(
        configuration,
        session,
        async () => next,
      )
      await expect(client.request('/api/test')).rejects.toThrow(
        'account or workspace changed',
      )
      expect(fetch).toHaveBeenCalledTimes(1)
      client.close()
    },
  )

  it('refreshes an expiring session before issuing requests', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const exchange = vi.fn().mockResolvedValue({ ...session, token: 'new' })
    const client = createAssertClient(
      configuration,
      { ...session, expiresAt: new Date().toISOString() },
      exchange,
    )
    await Promise.all([client.request('/api/one'), client.request('/api/two')])
    expect(exchange).toHaveBeenCalledTimes(1)
    expect(
      fetch.mock.calls.every(
        ([, init]) => init.headers.get('authorization') === 'Bearer new',
      ),
    ).toBe(true)
    client.close()
  })

  it('never sends credentials to another origin or follows redirects', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302 }))
    vi.stubGlobal('fetch', fetch)
    const client = createAssertClient(
      configuration,
      session,
      async () => session,
    )
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
