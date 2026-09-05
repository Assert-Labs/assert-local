import crypto from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import Fastify from 'fastify'
import { createAssertClient, type AssertSession } from './assert-api.js'
import type { CliConfiguration } from './config.js'
import { startPolling } from './poll.js'
import { fetchWithDiagnostics } from './fetch.js'

interface LocalServerOptions {
  configuration: CliConfiguration
  session: AssertSession
  repository: { owner: string; repo: string }
  pullNumber?: number
  refreshSession: (signal: AbortSignal) => Promise<AssertSession>
  warmIntervalMs?: number | false
  onWarmError?: (error: unknown) => void
}

const DEFAULT_WARM_INTERVAL_MS = 2 * 60 * 1000

const REQUEST_HEADERS_TO_DROP = new Set([
  'authorization',
  'connection',
  'content-length',
  'cookie',
  'host',
  'origin',
  'proxy-authorization',
  'referer',
  'transfer-encoding',
  'upgrade',
])

const RESPONSE_HEADERS_TO_DROP = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'content-security-policy',
  'set-cookie',
  'transfer-encoding',
])

function requestHeaders(headers: IncomingHttpHeaders) {
  const output = new Headers({ 'accept-encoding': 'identity' })
  for (const [name, value] of Object.entries(headers)) {
    if (value == null || REQUEST_HEADERS_TO_DROP.has(name.toLowerCase())) {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) output.append(name, item)
    } else {
      output.set(name, value)
    }
  }
  return output
}

function appendRuntimeScript(html: string) {
  const script = '<script src="/__assert-local/config.js"></script>'
  return html.includes('</head>')
    ? html.replace('</head>', `${script}</head>`)
    : `${script}${html}`
}

function rewriteLocation(
  location: string,
  localOrigin: string,
  configuration: CliConfiguration,
) {
  const url = new URL(location, localOrigin)
  if (
    url.origin === configuration.webUrl ||
    url.origin === configuration.apiUrl
  ) {
    return `${localOrigin}${url.pathname}${url.search}${url.hash}`
  }
  return location
}

export async function startLocalServer(options: LocalServerOptions) {
  const fastify = Fastify({ logger: false })
  const api = createAssertClient(
    options.configuration,
    options.session,
    options.refreshSession,
  )
  const lifetime = new AbortController()
  fastify.removeAllContentTypeParsers()
  fastify.addContentTypeParser(
    '*',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  )

  const launchToken = crypto.randomBytes(24).toString('base64url')
  const browserToken = crypto.randomBytes(24).toString('base64url')
  let localOrigin = ''
  let browserCookie = ''

  fastify.all('/*', async (request, reply) => {
    const expectedHost = new URL(localOrigin).host
    if (request.headers.host !== expectedHost) {
      return reply.code(421).send('Unexpected host')
    }

    const incomingUrl = new URL(request.raw.url ?? '/', localOrigin)
    if (incomingUrl.origin !== localOrigin) {
      return reply.code(400).send('Unexpected request URL')
    }
    const pathname = incomingUrl.pathname
    if (pathname === `/__assert-local/launch/${launchToken}`) {
      reply.header(
        'set-cookie',
        `${browserCookie}; Path=/; HttpOnly; SameSite=Strict`,
      )
      const { owner, repo } = options.repository
      return reply.redirect(
        options.pullNumber == null
          ? '/local/inbox'
          : `/review/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${options.pullNumber}`,
      )
    }

    const cookies = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
    if (!cookies?.includes(browserCookie)) {
      return reply.code(401).send('This Assert Local session is not available.')
    }

    if (pathname === '/__assert-local/health') {
      return reply.header('cache-control', 'no-store').code(204).send()
    }

    if (pathname === '/__assert-local/config.js') {
      const runtimeConfiguration = JSON.stringify({
        mode: 'local',
        apiUrl: localOrigin,
        appUrl: options.configuration.webUrl,
        workspaceId: options.session.workspace.id,
        repository: {
          providerId: 'github',
          repoInfo: options.repository,
        },
      }).replaceAll('<', '\\u003c')
      return reply
        .type('application/javascript; charset=utf-8')
        .header('cache-control', 'no-store')
        .send(
          `Object.defineProperty(window, "__ASSERT_RUNTIME_CONFIG__", { value: ${runtimeConfiguration} });`,
        )
    }

    const incomingOrigin = request.headers.origin
    if (
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      incomingOrigin !== localOrigin
    ) {
      return reply.code(403).send('Unexpected request origin')
    }

    const isApiRequest = pathname.startsWith('/api/')
    const targetOrigin = isApiRequest
      ? options.configuration.apiUrl
      : options.configuration.webUrl
    const path = `${incomingUrl.pathname}${incomingUrl.search}`
    const targetUrl = new URL(targetOrigin)
    targetUrl.pathname = incomingUrl.pathname
    targetUrl.search = incomingUrl.search
    const headers = requestHeaders(request.headers)
    if (incomingOrigin != null) headers.set('origin', targetOrigin)
    const disconnected = new AbortController()
    const onClose = () => disconnected.abort()
    reply.raw.on('close', onClose)
    try {
      const init: RequestInit = {
        method: request.method,
        headers,
        body:
          request.method === 'GET' || request.method === 'HEAD'
            ? undefined
            : (request.body as Buffer | undefined),
        redirect: 'manual',
        signal: AbortSignal.any([
          lifetime.signal,
          disconnected.signal,
          AbortSignal.timeout(120_000),
        ]),
      }
      const response = await (isApiRequest
        ? api.request(path, init)
        : fetchWithDiagnostics(targetUrl, init, 'Loading the Assert web app'))

      reply.code(response.status)
      response.headers.forEach((value, name) => {
        if (RESPONSE_HEADERS_TO_DROP.has(name.toLowerCase())) return
        reply.header(
          name,
          name.toLowerCase() === 'location'
            ? rewriteLocation(value, localOrigin, options.configuration)
            : value,
        )
      })

      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('text/html')) {
        return reply
          .type(contentType)
          .send(appendRuntimeScript(await response.text()))
      }
      return reply.send(Buffer.from(await response.arrayBuffer()))
    } finally {
      reply.raw.off('close', onClose)
    }
  })

  await fastify.listen({ host: '127.0.0.1', port: 0 })
  const address = fastify.server.address()
  if (address == null || typeof address === 'string') {
    await fastify.close()
    throw new Error('Could not determine the local server address')
  }
  localOrigin = `http://127.0.0.1:${address.port}`
  // Cookies are shared across ports, unlike browser storage.
  browserCookie = `assert.local.${address.port}=${browserToken}`

  const warmPullRequests = async (signal: AbortSignal) => {
    const response = await api.request('/api/workspaces/pull-requests/warm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        workspaceId: options.session.workspace.id,
        repository: `github:${options.repository.owner}/${options.repository.repo}`,
      }),
    })
    await response.body?.cancel()
    if (!response.ok) {
      throw new Error(`Inbox warming failed (${response.status})`)
    }
  }

  const warmIntervalMs = options.warmIntervalMs ?? DEFAULT_WARM_INTERVAL_MS
  const stopPolling =
    warmIntervalMs === false
      ? undefined
      : startPolling(warmPullRequests, warmIntervalMs, options.onWarmError)

  return {
    origin: localOrigin,
    launchUrl: `${localOrigin}/__assert-local/launch/${launchToken}`,
    async close() {
      stopPolling?.()
      lifetime.abort()
      api.close()
      await fastify.close()
    },
  }
}
