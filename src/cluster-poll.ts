import { setTimeout as delay } from 'node:timers/promises'
import { findCluster, type ClustersResponse } from './clusters.js'

export async function pollClusters(
  fetchStatus: (signal: AbortSignal) => Promise<ClustersResponse>,
  options: {
    timeoutMs: number
    wait: boolean
    waitUntil: 'usable' | 'ready'
    clusterId?: string
  },
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  let last: ClustersResponse | undefined
  try {
    for (;;) {
      last = await new Promise<ClustersResponse>((resolve, reject) => {
        const aborted = () => reject(new Error('Clustering wait timed out'))
        controller.signal.addEventListener('abort', aborted, { once: true })
        if (controller.signal.aborted) {
          aborted()
          return
        }
        fetchStatus(controller.signal)
          .then(resolve, reject)
          .finally(() =>
            controller.signal.removeEventListener('abort', aborted),
          )
      })
      const usable =
        last.status !== 'pending' &&
        (options.clusterId == null ||
          findCluster(last.tree, options.clusterId) != null)
      if (
        last.status === 'ready' ||
        (usable && options.waitUntil === 'usable') ||
        !options.wait
      ) {
        return { result: last, timedOut: false }
      }
      await delay(last.retryAfterSeconds * 1000, undefined, {
        signal: controller.signal,
      })
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error
    return { result: last, timedOut: true }
  } finally {
    clearTimeout(timer)
  }
}
