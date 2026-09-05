const networkErrors: Record<string, string> = {
  ENOTFOUND:
    'DNS could not resolve the hostname. Check the URL and your DNS or VPN connection.',
  EAI_AGAIN:
    'DNS lookup temporarily failed. Check your DNS or VPN connection and retry.',
  ECONNREFUSED:
    'The connection was refused. Check that the service is running at this host and port.',
  ECONNRESET:
    'The connection was reset. Check your network, VPN, or proxy and retry.',
  ENETUNREACH:
    'The network is unreachable. Check your network or VPN connection.',
  EHOSTUNREACH:
    'The host is unreachable. Check your network or VPN connection.',
  ETIMEDOUT:
    'The connection timed out. Check the URL, network, VPN, or firewall and retry.',
  UND_ERR_CONNECT_TIMEOUT:
    'The connection timed out. Check the URL, network, VPN, or firewall and retry.',
  UND_ERR_HEADERS_TIMEOUT:
    'The server took too long to respond. Retry or check service availability.',
  UND_ERR_BODY_TIMEOUT:
    'The server stopped sending data. Retry or check service availability.',
  UND_ERR_SOCKET:
    'The connection closed unexpectedly. Check your network or proxy and retry.',
  CERT_HAS_EXPIRED:
    'The TLS certificate has expired. Check the server certificate and your system clock.',
  ERR_TLS_CERT_ALTNAME_INVALID:
    'The TLS certificate does not match the hostname. Check the configured URL.',
  DEPTH_ZERO_SELF_SIGNED_CERT:
    'The TLS certificate is self-signed. Configure a trusted certificate or your organization’s CA.',
  SELF_SIGNED_CERT_IN_CHAIN:
    'The TLS certificate chain contains an untrusted certificate. Check your organization’s proxy or CA configuration.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    'The TLS certificate chain could not be verified. Check the server certificate chain or your organization’s CA configuration.',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
    'The TLS certificate issuer is not trusted. Check the server certificate chain or your organization’s CA configuration.',
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
        ? 'The request timed out. Retry or check service availability.'
        : codes.length > 0
          ? codes.map((code) => `${code}: ${networkErrors[code]}`).join(' ')
          : 'The network request failed. Check the URL, network, VPN, proxy, and TLS configuration.'
    // Raw fetch errors can contain credentials, request URLs, or proxy details.
    throw new Error(`${operation} at ${url.origin} failed. ${detail}`)
  }
}
