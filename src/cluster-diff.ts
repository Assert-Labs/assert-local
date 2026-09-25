import type { ClusterLeaf } from './clusters.js'

// Git quotes unusual paths using C escapes, including octal UTF-8 bytes.
function gitPath(value: string) {
  if (!value.startsWith('"')) return value
  const bytes: number[] = []
  for (let i = 1; i < value.length - 1; i++) {
    if (value.charAt(i) !== '\\') {
      bytes.push(...Buffer.from(value.charAt(i)))
      continue
    }
    const octal = /^[0-7]{1,3}/.exec(value.slice(i + 1))?.[0]
    if (octal != null) {
      bytes.push(Number.parseInt(octal, 8))
      i += octal.length
    } else {
      i++
      bytes.push(
        ...Buffer.from(
          (
            {
              t: '\t',
              n: '\n',
              r: '\r',
              b: '\b',
              f: '\f',
              v: '\v',
              a: '\x07',
            } as Record<string, string>
          )[value.charAt(i)] ?? value.charAt(i),
        ),
      )
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

function fileName(lines: string[]) {
  const newPath = lines.find((line) => line.startsWith('+++ '))
  const oldPath = lines.find((line) => line.startsWith('--- '))
  const patchPath = newPath === '+++ /dev/null' ? oldPath : newPath
  if (patchPath != null)
    return gitPath(patchPath.slice(4).replace(/\t.*$/, '')).slice(2)
  const rename = lines.find((line) => line.startsWith('rename to '))
  if (rename != null) return gitPath(rename.slice(10))
  // Binary/mode-only patches need their diff header, which has no ---/+++ lines.
  const header =
    /^diff --git ("(?:[^"\\]|\\.)*"|a\/.*?) ("(?:[^"\\]|\\.)*"|b\/.*)$/.exec(
      lines[0] ?? '',
    )
  return header == null ? undefined : gitPath(header[2]!).slice(2)
}

/** Produce review-only unified diff excerpts, preserving original line coordinates. */
export function sliceClusterDiff(diff: string, leaves: ClusterLeaf[]) {
  const sections = diff
    .split(/(?=^diff --git )/m)
    .filter((section) => section.startsWith('diff --git '))
  const output: string[] = []
  const found = new Set<string>()
  for (const section of sections) {
    const lines = section.replace(/\n$/, '').split('\n')
    const firstHunk = lines.findIndex((line) => line.startsWith('@@ '))
    const header = firstHunk === -1 ? lines : lines.slice(0, firstHunk)
    const name = fileName(header)
    const ranges = leaves.filter((leaf) => leaf.fileName === name)
    if (ranges.length === 0) continue
    ranges.forEach((range) => found.add(range.fileName))
    if (ranges.some((range) => 'fullFile' in range)) {
      output.push(section.replace(/\n$/, ''))
      continue
    }
    const excerpts: string[] = []
    let oldLine = 0
    let newLine = 0
    let block: string[] = []
    let oldStart = 0
    let newStart = 0
    let oldCount = 0
    let newCount = 0
    const flush = () => {
      if (block.some((line) => line.startsWith('+') || line.startsWith('-'))) {
        excerpts.push(
          `@@ -${oldCount === 0 ? oldStart - 1 : oldStart},${oldCount} +${newCount === 0 ? newStart - 1 : newStart},${newCount} @@\n${block.join('\n')}`,
        )
      }
      block = []
      oldCount = 0
      newCount = 0
    }
    for (const line of lines.slice(firstHunk < 0 ? lines.length : firstHunk)) {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
      if (hunk != null) {
        flush()
        oldLine = Number(hunk[1]) + (hunk[2] === '0' ? 1 : 0)
        newLine = Number(hunk[3]) + (hunk[4] === '0' ? 1 : 0)
        continue
      }
      if (line.startsWith('\\')) {
        if (block.length > 0) block.push(line)
        continue
      }
      const prefix = line[0]
      if (prefix !== '+' && prefix !== '-' && prefix !== ' ') continue
      const selected = ranges.some((range) => {
        if ('fullFile' in range) return true
        const oldMatch =
          oldLine >= range.oldStart && oldLine < range.oldStart + range.oldLines
        const newMatch =
          newLine >= range.newStart && newLine < range.newStart + range.newLines
        return prefix === '-'
          ? oldMatch
          : prefix === '+'
            ? newMatch
            : oldMatch && newMatch
      })
      if (selected) {
        if (block.length === 0) {
          oldStart = oldLine
          newStart = newLine
        }
        block.push(line)
        if (prefix !== '+') oldCount++
        if (prefix !== '-') newCount++
      } else flush()
      if (prefix !== '+') oldLine++
      if (prefix !== '-') newLine++
    }
    flush()
    if (excerpts.length > 0) output.push([...header, ...excerpts].join('\n'))
  }
  const missing = [...new Set(leaves.map((leaf) => leaf.fileName))].filter(
    (name) => !found.has(name),
  )
  if (missing.length > 0)
    throw new Error(
      `The GitHub diff is incomplete for this cluster. Missing files: ${missing.join(', ')}`,
    )
  return output.join('\n') + (output.length > 0 ? '\n' : '')
}
