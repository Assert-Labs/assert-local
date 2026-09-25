import { afterEach, describe, expect, it, vi } from 'vitest'
import { pollClusters } from '../cluster-poll.js'
import {
  clusterLeaves,
  clusterUrl,
  findCluster,
  type ClustersResponse,
  type ClusterGroup,
} from '../clusters.js'
import { parseTimeout } from '../commands/clusters.js'

const snapshot = {
  repository: 'example/project',
  pullNumber: 12,
  version: 1,
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  reviewUrl: 'https://app.assert.dev/review/github/example/project/12?v=1',
  retryAfterSeconds: 0.01,
}
const tree: ClusterGroup = {
  kind: 'group',
  id: 'root',
  title: 'Change',
  description: '',
  pendingSubclustering: true,
  children: [],
}
const pending: ClustersResponse = { ...snapshot, status: 'pending' }
const partial: ClustersResponse = { ...snapshot, status: 'partial', tree }
const ready: ClustersResponse = { ...snapshot, status: 'ready', tree }
const options = { timeoutMs: 500, wait: true, waitUntil: 'usable' as const }

afterEach(() => vi.restoreAllMocks())
describe('cluster polling', () => {
  it('returns partial results as soon as usable', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(pending)
      .mockResolvedValue(partial)
    expect(await pollClusters(fetch, options)).toEqual({
      result: partial,
      timedOut: false,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('can wait until recursive clustering completes', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(partial)
      .mockResolvedValue(ready)
    expect(
      (await pollClusters(fetch, { ...options, waitUntil: 'ready' })).result
        ?.status,
    ).toBe('ready')
  })
  it('keeps waiting for a requested child missing from partial results', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(partial)
      .mockResolvedValue(ready)
    await pollClusters(fetch, { ...options, clusterId: 'later-child' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('returns the last status on timeout', async () => {
    expect(
      await pollClusters(async () => pending, { ...options, timeoutMs: 20 }),
    ).toEqual({ result: pending, timedOut: true })
  })
  it('bounds a stalled request and reports unknown status', async () => {
    const fetch = (signal: AbortSignal) =>
      new Promise<ClustersResponse>((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      )
    expect(await pollClusters(fetch, { ...options, timeoutMs: 10 })).toEqual({
      result: undefined,
      timedOut: true,
    })
  })
  it('does not retry authentication/access errors', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('ACCESS_DENIED'))
    await expect(pollClusters(fetch, options)).rejects.toThrow('ACCESS_DENIED')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('no-wait makes one request', async () => {
    const fetch = vi.fn().mockResolvedValue(pending)
    expect(
      (await pollClusters(fetch, { ...options, wait: false })).timedOut,
    ).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

it('finds descendants and constructs encoded version-pinned links', () => {
  const child = {
    ...tree,
    id: 'area:child',
    children: [
      { kind: 'leaf' as const, fileName: 'file.ts', fullFile: true as const },
    ],
  }
  const root = { ...tree, children: [child] }
  expect(findCluster(root, child.id)).toBe(child)
  expect(clusterLeaves(root)).toEqual(child.children)
  const url = new URL(clusterUrl(snapshot.reviewUrl, child.id))
  expect(url.searchParams.get('v')).toBe('1')
  expect(url.searchParams.get('cluster')).toBe(child.id)
})

it('parses durations and rejects invalid or overflowing timers', () => {
  expect(parseTimeout('2m')).toBe(120000)
  expect(parseTimeout('500ms')).toBe(500)
  expect(parseTimeout('30')).toBe(30000)
  for (const value of ['0', '-1s', 'never', '999999999999m'])
    expect(() => parseTimeout(value)).toThrow()
})
