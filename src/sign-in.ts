import { createHash, randomBytes } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { CliConfiguration } from './config.js'
import { fetchWithDiagnostics } from './fetch.js'

const CALLBACK_PATH = '/callback'
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000

export interface BrowserSession {
  token: string
}

function respond(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  })
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Assert Local</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #0a0a0a; color: #fafafa; }
      p { color: #a3a3a3; }
    </style>
  </head>
  <body>
    <main><h1>${message}</h1><p>You can close this tab and return to your terminal.</p></main>
  </body>
</html>`)
}

/**
 * Waits on an ephemeral loopback port for the browser to hand back an
 * authorization code. Requests without the expected `state` are ignored.
 */
export async function listenForCallback({
  state,
  timeoutMs = SIGN_IN_TIMEOUT_MS,
}: {
  state: string
  timeoutMs?: number
}) {
  let resolveCode!: (code: string) => void
  let rejectCode!: (error: Error) => void
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  code.catch(() => {})

  let host = ''
  const server = createServer((request, response) => {
    // Rejects DNS-rebound pages posing as the loopback origin
    if (request.headers.host !== host) {
      return respond(response, 421, 'Unexpected request')
    }
    const url = new URL(request.url ?? '/', `http://${host}`)
    if (
      request.method !== 'GET' ||
      url.pathname !== CALLBACK_PATH ||
      url.searchParams.get('state') !== state
    ) {
      return respond(response, 400, 'This sign-in link is no longer valid')
    }
    const receivedCode = url.searchParams.get('code')
    if (receivedCode) {
      respond(response, 200, 'Signed in to Assert')
      resolveCode(receivedCode)
    } else {
      respond(response, 200, 'Sign-in cancelled')
      rejectCode(new Error('Sign-in was cancelled.'))
    }
  })

  const timeout = setTimeout(
    () => rejectCode(new Error('Sign-in timed out. Run the command again.')),
    timeoutMs,
  )
  void code
    .finally(() => {
      clearTimeout(timeout)
      server.close()
      server.closeAllConnections()
    })
    .catch(() => {})

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  host = `127.0.0.1:${port}`

  return {
    redirectUri: `http://${host}${CALLBACK_PATH}`,
    code,
    cancel: () => rejectCode(new Error('Sign-in was cancelled.')),
  }
}

export async function redeemAuthorizationCode(
  configuration: CliConfiguration,
  input: { code: string; codeVerifier: string; redirectUri: string },
): Promise<BrowserSession> {
  const response = await fetchWithDiagnostics(
    new URL('/api/auth/desktop/token', configuration.apiUrl),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    },
    'Assert sign-in',
  )
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(
      response.status === 400
        ? 'This sign-in link has expired. Run the command again.'
        : `Assert sign-in failed (HTTP ${response.status}). Try again later. If it continues, contact support@assert.dev.`,
    )
  }
  const body = (await response.json().catch(() => undefined)) as
    { token?: unknown } | undefined
  if (typeof body?.token !== 'string' || !body.token) {
    throw new Error(
      'Assert sign-in returned an unexpected response. Try again, or update with `npx assert-local@latest`.',
    )
  }
  return { token: body.token }
}

/** Signs in through the browser, where the user already has their Assert session. */
export async function signInWithBrowser(
  configuration: CliConfiguration,
  openBrowser: (url: string) => Promise<void>,
) {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('base64url')
  const callback = await listenForCallback({ state })

  const authorizeUrl = new URL('/desktop/authorize', configuration.webUrl)
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('redirect_uri', callback.redirectUri)
  authorizeUrl.searchParams.set('state', state)
  console.log(
    `\nSign in to Assert in your browser. If it didn't open, visit:\n${authorizeUrl}\n`,
  )
  try {
    await openBrowser(authorizeUrl.toString())
  } catch {
    // The URL is printed above
  }

  const code = await callback.code
  return await redeemAuthorizationCode(configuration, {
    code,
    codeVerifier: verifier,
    redirectUri: callback.redirectUri,
  })
}
