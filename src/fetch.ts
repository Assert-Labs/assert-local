const networkErrors: Record<string, string> = {
  ENOTFOUND:
    'Your device could not find Assert’s server (DNS lookup failed). Check your internet or VPN connection and try again.',
  EAI_AGAIN:
    'Your device temporarily could not find Assert’s server (DNS lookup failed). Check your internet or VPN connection and try again.',
  ECONNREFUSED:
    'The connection was refused. Assert may be unavailable, or your network may be blocking it. Try again later; if it continues, contact support@assert.dev.',
  ECONNRESET:
    'The connection was interrupted. Check your internet or VPN connection and try again.',
  ENETUNREACH:
    'The network is unreachable. Check your internet or VPN connection and try again.',
  EHOSTUNREACH:
    'Assert could not be reached. Check your internet or VPN connection and try again.',
  ETIMEDOUT:
    'The connection timed out. Check your internet or VPN connection and try again. If it continues, contact support@assert.dev.',
  UND_ERR_CONNECT_TIMEOUT:
    'The connection timed out. Check your internet or VPN connection and try again. If it continues, contact support@assert.dev.',
  UND_ERR_HEADERS_TIMEOUT:
    'Assert took too long to respond. Try again later. If it continues, contact support@assert.dev.',
  UND_ERR_BODY_TIMEOUT:
    'The connection stopped receiving data. Check your internet connection and try again.',
  UND_ERR_SOCKET:
    'The connection closed unexpectedly. Check your internet or VPN connection and try again.',
  CERT_HAS_EXPIRED:
    'The security certificate has expired. Check your device’s date and time. If they are correct, contact support@assert.dev.',
  ERR_TLS_CERT_ALTNAME_INVALID:
    'The security certificate does not match the service. We stopped the connection to protect your account. Contact support@assert.dev.',
  DEPTH_ZERO_SELF_SIGNED_CERT:
    'The security certificate is self-signed, so we could not verify the connection. On a managed network, ask your IT team for help; otherwise contact support@assert.dev.',
  SELF_SIGNED_CERT_IN_CHAIN:
    'The connection includes an untrusted security certificate. On a managed network, ask your IT team for help; otherwise contact support@assert.dev.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    'The security certificate could not be verified. On a managed network, ask your IT team for help; otherwise contact support@assert.dev.',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
    'Your device does not trust the security certificate’s issuer. On a managed network, ask your IT team for help; otherwise contact support@assert.dev.',
}

function networkErrorCodes(error: unknown, depth = 0): string[] {
  if (!(error instanceof Error) || depth > 4) return []
  const codes =
    'code' in error &&
    typeof error.code === 'string' &&
    Object.hasOwn(networkErrors, error.code)
      ? [error.code]
      : []
  return [
    ...codes,
    ...networkErrorCodes(error.cause, depth + 1),
    ...(error instanceof AggregateError
      ? error.errors.flatMap((cause) => networkErrorCodes(cause, depth + 1))
      : []),
  ]
}

export async function fetchWithDiagnostics(
  url: URL,
  init: RequestInit,
  operation: string,
): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted && init.signal.reason?.name !== 'TimeoutError') {
      throw error
    }
    const codes = [...new Set(networkErrorCodes(error))]
    const detail =
      init.signal?.reason?.name === 'TimeoutError'
        ? 'The request timed out. Check your internet connection and try again. If it continues, contact support@assert.dev.'
        : codes.length > 0
          ? codes.map((code) => `${code}: ${networkErrors[code]}`).join(' ')
          : 'We could not connect to Assert. Check your internet or VPN connection and try again. If it continues, contact support@assert.dev.'
    // Raw fetch errors can contain credentials, request URLs, or proxy details.
    throw new Error(`${operation} failed. ${detail}`)
  }
}
