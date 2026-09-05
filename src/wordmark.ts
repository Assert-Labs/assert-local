const wordmark = `▄▀█ █▀ █▀ █▀▀ █▀█ ▀█▀
█▀█ ▄█ ▄█ ██▄ █▀▄  █`

export function formatWordmark(
  output: Pick<NodeJS.WriteStream, 'isTTY' | 'hasColors'> = process.stdout,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const forceColor = environment.FORCE_COLOR
  const useColor =
    forceColor != null
      ? ['', '1', '2', '3', 'true'].includes(forceColor)
      : environment.NO_COLOR == null &&
        output.isTTY &&
        output.hasColors(16, environment)

  return useColor ? `\u001b[33m${wordmark}\u001b[39m` : wordmark
}
