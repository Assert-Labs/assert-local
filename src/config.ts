export interface CliConfiguration {
  webUrl: string
  apiUrl: string
}

function origin(value: string, variable: string) {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${variable} must use http or https`)
  }
  return url.origin
}

export function getConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): CliConfiguration {
  return {
    webUrl: origin(
      environment.ASSERT_WEB_URL ?? 'https://app.assert.dev',
      'ASSERT_WEB_URL',
    ),
    apiUrl: origin(
      environment.ASSERT_API_URL ?? 'https://api.assert.dev',
      'ASSERT_API_URL',
    ),
  }
}
