import { clusterLeaves, clusterUrl, type ClusterGroup } from './clusters.js'
import type { ClusterDiffStats } from './cluster-diff.js'

function groups(tree: ClusterGroup) {
  return tree.children.filter((child) => child.kind === 'group')
}

function fileCount(tree: ClusterGroup) {
  return new Set(clusterLeaves(tree).map((leaf) => leaf.fileName)).size
}

function count(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? '' : 's'}`
}

function scope(tree: ClusterGroup) {
  const children = groups(tree)
  return `${count(fileCount(tree), 'file')}${children.length === 0 ? '' : ` · ${count(children.length, 'subcluster')}`}`
}

export function formatClusterList(
  tree: ClusterGroup,
  reviewUrl: string,
  maxDepth: number,
  depth = 0,
): string {
  const prefix = '  '.repeat(depth)
  return [
    `${prefix}${tree.title}${tree.pendingSubclustering ? ' (subdividing)' : ''}`,
    `${prefix}  ID: ${tree.id}`,
    ...tree.description
      .split('\n')
      .filter(Boolean)
      .map((line) => `${prefix}  ${line}`),
    `${prefix}  Scope: ${scope(tree)}`,
    `${prefix}  Review: ${clusterUrl(reviewUrl, tree.id)}`,
    ...(depth >= maxDepth
      ? []
      : groups(tree).map(
          (child) =>
            `\n${formatClusterList(child, reviewUrl, maxDepth, depth + 1)}`,
        )),
  ].join('\n')
}

export function findParentCluster(
  tree: ClusterGroup,
  id: string,
): ClusterGroup | undefined {
  for (const child of groups(tree)) {
    if (child.id === id) return tree
    const parent = findParentCluster(child, id)
    if (parent != null) return parent
  }
  return undefined
}

export function formatClusterDetail(
  tree: ClusterGroup,
  reviewUrl: string,
  options: {
    stats?: ClusterDiffStats
    statsError?: string
    parent?: ClusterGroup
    allFiles?: boolean
  },
) {
  const files =
    options.stats?.files ??
    [...new Set(clusterLeaves(tree).map((leaf) => leaf.fileName))].map(
      (fileName) => ({
        fileName,
        additions: undefined,
        deletions: undefined,
        binary: false,
        renamed: false,
      }),
    )
  const sorted = [...files].sort((a, b) => {
    const weight = (file: typeof a) =>
      (file.additions ?? 0) + (file.deletions ?? 0)
    return weight(b) - weight(a) || a.fileName.localeCompare(b.fileName)
  })
  const limit = options.allFiles ? sorted.length : 5
  const children = groups(tree)
  return [
    tree.title + (tree.pendingSubclustering ? ' (subdividing)' : ''),
    `ID: ${tree.id}`,
    ...(options.parent == null
      ? []
      : [`Parent: ${options.parent.title}`, `Parent ID: ${options.parent.id}`]),
    '',
    tree.description,
    '',
    `Changes: ${count(files.length, 'file')}${options.stats == null ? ' · line stats unavailable' : ` · +${options.stats.additions} −${options.stats.deletions}`}`,
    ...(options.statsError == null
      ? []
      : [`Stats unavailable: ${options.statsError}`]),
    `Review: ${clusterUrl(reviewUrl, tree.id)}`,
    ...(files.length === 0
      ? []
      : [
          '',
          options.stats == null ? 'Files:' : 'Files (largest changes first):',
          ...sorted.slice(0, limit).map((file) => {
            const stats =
              file.additions != null
                ? file.binary
                  ? 'binary'
                  : `+${file.additions} −${file.deletions}`
                : ''
            return `  ${file.fileName}${stats ? `  ${stats}` : ''}${file.renamed ? ' (renamed)' : ''}`
          }),
        ]),
    ...(files.length > limit
      ? [
          `  … ${count(files.length - limit, 'more file')}; use --files to show all.`,
        ]
      : []),
    ...(children.length === 0
      ? []
      : [
          '',
          'Subclusters:',
          children
            .map((child) => formatClusterList(child, reviewUrl, 1, 1))
            .join('\n\n'),
        ]),
  ].join('\n')
}
