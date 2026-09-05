const wordmark = `▄▀█ █▀ █▀ █▀▀ █▀█ ▀█▀
█▀█ ▄█ ▄█ ██▄ █▀▄  █`

export function formatWordmark() {
  const forceColor = process.env.FORCE_COLOR
  const useColor =
    forceColor != null
      ? ['', '1', '2', '3', 'true'].includes(forceColor)
      : process.env.NO_COLOR == null &&
        process.stdout.isTTY &&
        process.stdout.hasColors(16)

  return useColor ? `\u001b[33m${wordmark}\u001b[39m` : wordmark
}
