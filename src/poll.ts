export function startPolling(
  run: (signal: AbortSignal) => Promise<void>,
  intervalMs: number,
  onError?: (error: unknown) => void,
) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let errorReported = false

  const tick = async () => {
    try {
      await run(controller.signal)
      errorReported = false
    } catch (error) {
      if (!controller.signal.aborted && !errorReported) onError?.(error)
      errorReported = true
    } finally {
      if (!controller.signal.aborted) {
        timer = setTimeout(() => void tick(), intervalMs)
        timer.unref()
      }
    }
  }
  void tick()
  return () => {
    controller.abort()
    clearTimeout(timer)
  }
}
