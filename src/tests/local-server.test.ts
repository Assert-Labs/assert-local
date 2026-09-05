import { createServer } from 'node:http'
import type { RequestListener } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssertSession } from '../assert-api.js'
import { startLocalServer } from '../local-server.js'

const closers: Array<() => Promise<unknown>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

async function listen(
  handler: RequestListener,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address == null || typeof address === 'string') {
    throw new Error('Missing test server address')
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}

const session: AssertSession = {
  token: 'old-session-token',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  githubUser: { id: '1', login: 'octocat' },
  workspace: { id: 'workspace-1', name: 'Test User', slug: '@test-user' },
}

describe('local server', () => {
  it('protects the proxy, injects runtime configuration, and refreshes auth', async () => {
    const webHeaders: Array<string | undefined> = []
    const web = await listen((request, response) => {
      webHeaders.push(request.headers.authorization)
      response.setHeader('content-type', 'text/html')
      response.end('<html><head></head><body>Assert</body></html>')
    })
    closers.push(web.close)

    const receivedTokens: Array<string | undefined> = []
    const receivedUrls: Array<string | undefined> = []
    const api = await listen((request, response) => {
      receivedTokens.push(request.headers.authorization)
      receivedUrls.push(request.url)
      if (request.headers.authorization === 'Bearer old-session-token') {
        response.statusCode = 401
        response.end('expired')
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: true }))
    })
    closers.push(api.close)

    const local = await startLocalServer({
      configuration: { webUrl: web.origin, apiUrl: api.origin },
      session,
      repository: { owner: 'Assert-Labs', repo: 'assert-local' },
      refreshSession: async () => ({ ...session, token: 'new-session-token' }),
      warmIntervalMs: false,
    })
    closers.push(local.close)

    expect((await fetch(local.origin)).status).toBe(401)

    const launch = await fetch(local.launchUrl, { redirect: 'manual' })
    expect(launch.status).toBe(302)
    const cookie = launch.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toMatch(/^assert\.local\.\d+=/)
    expect(launch.headers.get('location')).toBe('/local/inbox')

    const html = await fetch(local.origin, {
      headers: { cookie: cookie! },
    }).then((response) => response.text())
    expect(html).toContain('<script src="/__assert-local/config.js"></script>')

    const runtime = await fetch(`${local.origin}/__assert-local/config.js`, {
      headers: { cookie: cookie! },
    }).then((response) => response.text())
    expect(runtime).toContain(`apiUrl":"${local.origin}`)
    expect(runtime).toContain('Assert-Labs')
    expect(runtime).not.toContain(session.token)
    expect(webHeaders).toEqual([undefined])

    expect(
      (
        await fetch(`${local.origin}/api/test`, {
          method: 'POST',
          headers: { cookie: cookie!, origin: 'https://example.com' },
        })
      ).status,
    ).toBe(403)
    expect(receivedTokens).toEqual([])

    const health = await fetch(`${local.origin}/__assert-local/health`, {
      headers: { cookie: cookie! },
    })
    expect(health.status).toBe(204)
    expect(health.headers.get('cache-control')).toBe('no-store')

    const apiResponse = await fetch(
      `${local.origin}/api/test?page=2&state=open`,
      {
        headers: { cookie: cookie! },
      },
    )
    expect(await apiResponse.json()).toEqual({ ok: true })
    expect(receivedTokens).toEqual([
      'Bearer old-session-token',
      'Bearer new-session-token',
    ])
    expect(receivedUrls).toEqual([
      '/api/test?page=2&state=open',
      '/api/test?page=2&state=open',
    ])
  })

  it('keeps simultaneous inbox and direct-PR sessions authorized in a shared cookie jar', async () => {
    const configuration = {
      webUrl: 'https://app.assert.dev',
      apiUrl: 'https://api.assert.dev',
    }
    const first = await startLocalServer({
      configuration,
      session,
      repository: { owner: 'owner', repo: 'first' },
      refreshSession: async () => session,
      warmIntervalMs: false,
    })
    closers.push(first.close)
    const second = await startLocalServer({
      configuration,
      session,
      repository: { owner: 'owner', repo: 'second' },
      pullNumber: 123,
      refreshSession: async () => session,
      warmIntervalMs: false,
    })
    closers.push(second.close)

    const cookies = new Map<string, string>()
    for (const [local, expectedPath] of [
      [first, '/local/inbox'],
      [second, '/review/github/owner/second/123'],
    ] as const) {
      const launch = await fetch(local.launchUrl, { redirect: 'manual' })
      expect(launch.headers.get('location')).toBe(expectedPath)
      const cookie = launch.headers.get('set-cookie')!.split(';')[0]!
      cookies.set(cookie.split('=')[0]!, cookie)
    }
    expect(cookies.size).toBe(2)
    const cookie = [...cookies.values()].join('; ')
    for (const local of [first, second]) {
      const health = await fetch(`${local.origin}/__assert-local/health`, {
        headers: { cookie },
      })
      expect(health.status).toBe(204)
    }
    const secondCookie = [...cookies.values()][1]!
    const unauthorized = await fetch(`${first.origin}/__assert-local/health`, {
      headers: { cookie: secondCookie },
    })
    expect(unauthorized.status).toBe(401)
  })

  it('warms the repository inbox while the proxy is running', async () => {
    const web = await listen((_request, response) => {
      response.end('<html></html>')
    })
    closers.push(web.close)

    const requests: Array<{
      authorization?: string
      body: string
      url?: string
    }> = []
    const api = await listen((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        requests.push({
          authorization: request.headers.authorization,
          body: Buffer.concat(chunks).toString('utf8'),
          url: request.url,
        })
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ success: true }))
      })
    })
    closers.push(api.close)

    const local = await startLocalServer({
      configuration: { webUrl: web.origin, apiUrl: api.origin },
      session,
      repository: { owner: 'Assert-Labs', repo: 'assert-local' },
      refreshSession: async () => session,
      warmIntervalMs: 20,
    })
    closers.push(local.close)

    await vi.waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(2))
    expect(requests[0]).toEqual({
      authorization: 'Bearer old-session-token',
      body: JSON.stringify({
        workspaceId: 'workspace-1',
        repository: 'github:Assert-Labs/assert-local',
      }),
      url: '/api/workspaces/pull-requests/warm',
    })
  })

  it('cancels upstream work when stopped instead of waiting for a hung server', async () => {
    const received = vi.fn()
    const disconnected = vi.fn()
    const upstream = await listen((_request, response) => {
      received()
      response.on('close', disconnected)
    })
    closers.push(upstream.close)
    const local = await startLocalServer({
      configuration: { webUrl: upstream.origin, apiUrl: upstream.origin },
      session,
      repository: { owner: 'owner', repo: 'repo' },
      refreshSession: async () => session,
    })
    closers.push(local.close)
    await vi.waitFor(() => expect(received).toHaveBeenCalled())
    await local.close()
    await vi.waitFor(() => expect(disconnected).toHaveBeenCalled())
  })
})
