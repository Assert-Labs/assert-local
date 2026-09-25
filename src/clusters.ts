import { z } from 'zod'

export const ClusterLeaf = z.union([
  z.object({
    kind: z.literal('leaf'),
    fileName: z.string(),
    fullFile: z.literal(true),
  }),
  z.object({
    kind: z.literal('leaf'),
    fileName: z.string(),
    oldStart: z.number(),
    oldLines: z.number(),
    newStart: z.number(),
    newLines: z.number(),
  }),
])
export type ClusterLeaf = z.infer<typeof ClusterLeaf>
export const ClusterGroup = z.object({
  kind: z.literal('group'),
  id: z.string(),
  title: z.string(),
  description: z.string(),
  pendingSubclustering: z.boolean(),
  get children(): z.ZodArray<
    z.ZodUnion<[typeof ClusterLeaf, typeof ClusterGroup]>
  > {
    return z.array(z.union([ClusterLeaf, ClusterGroup]))
  },
})
export type ClusterGroup = z.infer<typeof ClusterGroup>
const Snapshot = z.object({
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  pullNumber: z.number().int().positive(),
  version: z.number().int().positive(),
  baseSha: z.string().regex(/^[a-f\d]{40}$/i),
  headSha: z.string().regex(/^[a-f\d]{40}$/i),
  reviewUrl: z.string().url(),
  retryAfterSeconds: z.number().positive().max(60),
})
export const ClustersResponse = z.discriminatedUnion('status', [
  Snapshot.extend({ status: z.literal('pending') }),
  Snapshot.extend({ status: z.literal('partial'), tree: ClusterGroup }),
  Snapshot.extend({ status: z.literal('ready'), tree: ClusterGroup }),
])
export type ClustersResponse = z.infer<typeof ClustersResponse>

export function findCluster(
  tree: ClusterGroup,
  id: string,
): ClusterGroup | undefined {
  if (tree.id === id) return tree
  for (const child of tree.children) {
    if (child.kind === 'group') {
      const match = findCluster(child, id)
      if (match != null) return match
    }
  }
  return undefined
}

export function clusterLeaves(tree: ClusterGroup): ClusterLeaf[] {
  return tree.children.flatMap((node) =>
    node.kind === 'leaf' ? [node] : clusterLeaves(node),
  )
}

export function clusterUrl(reviewUrl: string, id: string) {
  const url = new URL(reviewUrl)
  url.searchParams.set('cluster', id)
  return url.toString()
}

export function formatCluster(
  tree: ClusterGroup,
  reviewUrl: string,
  depth = 0,
): string {
  const leaves = clusterLeaves(tree)
  const files = [...new Set(leaves.map((leaf) => leaf.fileName))]
  const prefix = '  '.repeat(depth)
  return [
    `${prefix}${tree.id}: ${tree.title}${tree.pendingSubclustering ? ' (subdividing)' : ''}`,
    `${prefix}${tree.description}`,
    `${prefix}Files: ${files.join(', ') || '(none)'}`,
    `${prefix}${clusterUrl(reviewUrl, tree.id)}`,
    ...tree.children
      .filter((child) => child.kind === 'group')
      .map((child) => formatCluster(child, reviewUrl, depth + 1)),
  ].join('\n')
}
