import { execa } from 'execa'
import { createAssertClient, exchangeGithubToken } from '../assert-api.js'
import { getConfiguration } from '../config.js'
import { getCurrentRepository, getGhToken } from '../gh.js'
import { parseReviewTarget } from '../review-target.js'
import {
  ClustersResponse,
  clusterLeaves,
  clusterUrl,
  findCluster,
  formatCluster,
} from '../clusters.js'
import { sliceClusterDiff } from '../cluster-diff.js'
import { pollClusters } from '../cluster-poll.js'

class ClusterCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface ClusterOptions {
  repo?: string
  pr?: string
  json?: boolean
  timeout: string
  wait: boolean
  waitUntil: string
  diff?: boolean
}

export function parseTimeout(value: string) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(value)
  const ms =
    match == null
      ? NaN
      : Number(match[1]) *
        (match[2] === 'ms' ? 1 : match[2] === 'm' ? 60_000 : 1000)
  if (!Number.isFinite(ms) || ms < 1 || ms > 2_147_483_647)
    throw new Error(
      'Use a positive timeout such as 30s, 2m, or 500ms (maximum 24 days).',
    )
  return ms
}

async function resolveTarget(
  target: string | undefined,
  options: ClusterOptions,
) {
  const parsed = target == null ? undefined : parseReviewTarget(target)
  if (parsed != null && (options.repo != null || options.pr != null))
    throw new Error('Use either a PR URL or --repo/--pr, not both.')
  const repository =
    parsed?.repository ??
    (options.repo == null
      ? (await getCurrentRepository())?.nameWithOwner
      : parseReviewTarget(options.repo).repository)
  if (repository == null)
    throw new Error(
      'No current GitHub repository. Provide --repo owner/repo --pr number or a PR URL.',
    )
  let pullNumber = parsed?.pullNumber
  if (options.pr != null) {
    if (
      !/^[1-9]\d*$/.test(options.pr) ||
      !Number.isSafeInteger(Number(options.pr))
    )
      throw new Error('--pr must be a positive pull request number.')
    pullNumber = Number(options.pr)
  }
  if (pullNumber == null) {
    const current = await getCurrentRepository()
    if (current?.nameWithOwner.toLowerCase() !== repository.toLowerCase())
      throw new Error(
        'Provide --pr when selecting a repository other than the current repository.',
      )
    const result = await execa('gh', ['pr', 'view', '--json', 'number'], {
      reject: false,
      timeout: 15_000,
    })
    if (result.exitCode !== 0)
      throw new Error(
        'No pull request found for the current branch. Provide --pr number or a PR URL.',
      )
    const value = JSON.parse(result.stdout) as { number?: unknown }
    if (
      typeof value.number !== 'number' ||
      !Number.isSafeInteger(value.number) ||
      value.number < 1
    )
      throw new Error('gh returned an invalid pull request number.')
    pullNumber = value.number
  }
  return { repository, pullNumber }
}

export async function clustersCommand(
  options: ClusterOptions,
  target?: string,
  clusterId?: string,
) {
  let client: ReturnType<typeof createAssertClient> | undefined
  try {
    const timeoutMs = parseTimeout(options.timeout)
    if (options.waitUntil !== 'usable' && options.waitUntil !== 'ready')
      throw new Error('--wait-until must be usable or ready.')
    const { repository, pullNumber } = await resolveTarget(target, options)
    const configuration = getConfiguration()
    const exchange = async (signal?: AbortSignal) =>
      exchangeGithubToken(configuration, await getGhToken(signal), signal)
    client = createAssertClient(configuration, await exchange(), exchange)
    const path = `/api/v1/pulls/github/${repository}/${pullNumber}/clusters`
    const retryCommand = `assert-local ${clusterId == null ? 'clusters' : `cluster '${clusterId.replaceAll("'", "'\\''")}'`} --repo ${repository} --pr ${pullNumber}`
    const { result, timedOut } = await pollClusters(
      async (signal) => {
        const response = await client!.request(path, { signal })
        if (!response.ok) {
          const body = (await response.json().catch(() => undefined)) as
            { error?: { code?: string; message?: string } } | undefined
          const hint =
            response.status === 401
              ? ' Run `gh auth status` and sign in to Assert with the same account.'
              : response.status === 403
                ? ' Check your GitHub repository access and Assert account.'
                : ''
          throw new ClusterCommandError(
            body?.error?.code ?? `HTTP_${response.status}`,
            `${body?.error?.code ?? `HTTP_${response.status}`}: ${body?.error?.message ?? 'Could not retrieve clusters.'}${hint}`,
          )
        }
        const parsed = ClustersResponse.safeParse(await response.json())
        if (!parsed.success)
          throw new Error(
            'Assert returned an unexpected clustering response. Update assert-local or try again later.',
          )
        return parsed.data
      },
      {
        timeoutMs,
        wait: options.wait,
        waitUntil: options.waitUntil,
        clusterId,
      },
    )
    const selected =
      result != null && result.status !== 'pending' && clusterId != null
        ? findCluster(result.tree, clusterId)
        : undefined
    if (clusterId != null && selected == null && result?.status === 'ready')
      throw new ClusterCommandError(
        'CLUSTER_NOT_FOUND',
        `Cluster ${JSON.stringify(clusterId)} was not found in the latest clustering. Run \`assert-local clusters --repo ${repository} --pr ${pullNumber}\` to list current IDs.`,
      )
    let diff: string | undefined
    if (options.diff && selected != null && result != null) {
      const comparison = await execa(
        'gh',
        [
          'api',
          `repos/${repository}/compare/${result.baseSha}...${result.headSha}`,
          '-H',
          'Accept: application/vnd.github.diff',
        ],
        { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 },
      )
      diff = sliceClusterDiff(comparison.stdout, clusterLeaves(selected))
    }
    const message = timedOut
      ? result == null
        ? 'Timed out before receiving clustering status. Generation status is unknown.'
        : `Still generating clusters (${result.status}); the CLI stopped waiting. Server-side generation continues.`
      : result?.status === 'pending'
        ? 'Clusters are still generating.'
        : clusterId != null && selected == null
          ? 'The requested cluster is not available yet; subclustering is still running.'
          : undefined
    const output = {
      ...(result == null
        ? { repository, pullNumber, status: 'unknown' }
        : selected == null
          ? result
          : { ...result, tree: undefined }),
      timedOut,
      message,
      retryCommand,
      ...(selected == null
        ? {}
        : {
            cluster: selected,
            clusterUrl: clusterUrl(result!.reviewUrl, selected.id),
          }),
      ...(diff == null ? {} : { diff }),
    }
    if (options.json) console.log(JSON.stringify(output, null, 2))
    else {
      if (message != null) console.log(message)
      if (result != null) {
        console.log(
          `${repository}#${pullNumber} — ${result.status}\n${result.reviewUrl}`,
        )
        if (result.status !== 'pending')
          console.log(formatCluster(selected ?? result.tree, result.reviewUrl))
      }
      if (diff != null)
        console.log(`\n${diff || '(No textual changes in this cluster.)'}`)
      if (
        timedOut ||
        result?.status === 'pending' ||
        (clusterId != null && selected == null)
      )
        console.log(`Retry: ${retryCommand}`)
    }
    if (timedOut) process.exitCode = 2
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (options.json)
      console.log(
        JSON.stringify({
          error: {
            code:
              error instanceof ClusterCommandError
                ? error.code
                : 'COMMAND_FAILED',
            message,
          },
        }),
      )
    else console.error(message)
    process.exitCode = 1
  } finally {
    client?.close()
  }
}
