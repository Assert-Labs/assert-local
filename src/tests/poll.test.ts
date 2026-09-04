import { afterEach, describe, expect, it, vi } from 'vitest'
import { startPolling } from '../poll.js'

afterEach(() => vi.useRealTimers())

describe('polling', () => {
  it('does not overlap requests and aborts the active request on shutdown', async () => {
    vi.useFakeTimers()
    const run = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          })
        }),
    )
    const onError = vi.fn()
    const stop = startPolling(run, 100, onError)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).toHaveBeenCalledTimes(1)
    stop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run.mock.calls[0]?.[0].aborted).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports one error per outage and recovers on a successful poll', async () => {
    vi.useFakeTimers()
    const error = new Error('unavailable')
    const run = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(error)
    const onError = vi.fn()
    const stop = startPolling(run, 100, onError)
    await vi.advanceTimersByTimeAsync(200)
    expect(onError).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(onError).toHaveBeenCalledTimes(2)
    stop()
  })
})
