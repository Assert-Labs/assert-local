import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithDiagnostics } from '../fetch.js'

afterEach(() => vi.unstubAllGlobals())

describe('fetch diagnostics', () => {
  it.each([
    ['ENOTFOUND', 'DNS could not resolve'],
    ['ECONNREFUSED', 'connection was refused'],
    ['UND_ERR_CONNECT_TIMEOUT', 'connection timed out'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'TLS certificate does not match'],
  ])(
    'explains a nested %s failure without exposing request details',
    async (code, explanation) => {
      const cause = Object.assign(new Error('private-error-detail'), { code })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause })),
      )
      const error = await fetchWithDiagnostics(
        new URL(
          'https://user:password@api.example.com/private-repo?token=secret',
        ),
        { headers: { authorization: 'Bearer secret' } },
        'Assert sign-in',
      ).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(Error)
      const message = (error as Error).message
      expect(message).toContain(
        'Assert sign-in at https://api.example.com failed.',
      )
      expect(message).toContain(`${code}:`)
      expect(message).toContain(explanation)
      expect(message).not.toMatch(/password|private|secret|user:/)
      expect((error as Error).cause).toBeUndefined()
    },
  )

  it('extracts connection failures nested in an AggregateError', async () => {
    const failure = () =>
      Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(
        new TypeError('fetch failed', {
          cause: new AggregateError([failure(), failure()]),
        }),
      ),
    )
    const error = await fetchWithDiagnostics(
      new URL('https://api.example.com'),
      {},
      'Assert API request',
    ).catch((error: unknown) => error)
    expect((error as Error).message.match(/ECONNREFUSED/g)).toHaveLength(1)
  })

  it('identifies request deadlines separately from user cancellation', async () => {
    const timeout = new DOMException('deadline', 'TimeoutError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout))
    await expect(
      fetchWithDiagnostics(
        new URL('https://api.example.com'),
        {
          signal: AbortSignal.abort(timeout),
        },
        'Assert sign-in',
      ),
    ).rejects.toThrow('request timed out')

    const cancelled = new DOMException('cancelled', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cancelled))
    await expect(
      fetchWithDiagnostics(
        new URL('https://api.example.com'),
        {
          signal: AbortSignal.abort(cancelled),
        },
        'Assert sign-in',
      ),
    ).rejects.toBe(cancelled)
  })

  it('does not expose unknown error codes or messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(
        Object.assign(new Error('private detail'), {
          code: 'secret',
        }),
      ),
    )
    await expect(
      fetchWithDiagnostics(
        new URL('https://api.example.com'),
        {},
        'Assert sign-in',
      ),
    ).rejects.toThrow(
      'Assert sign-in at https://api.example.com failed. The network request failed. Check the URL, network, VPN, proxy, and TLS configuration.',
    )
  })
})
