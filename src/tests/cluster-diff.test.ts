import { describe, expect, it } from 'vitest'
import { sliceClusterDiff } from '../cluster-diff.js'
import type { ClusterLeaf } from '../clusters.js'

const range = (
  oldStart: number,
  oldLines: number,
  newStart: number,
  newLines: number,
): ClusterLeaf => ({
  kind: 'leaf',
  fileName: 'src/example.ts',
  oldStart,
  oldLines,
  newStart,
  newLines,
})
const diff = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,5 +1,5 @@
 first
-old one
+new one
 middle
-old two
+new two
 last
`

describe('cluster diff excerpts', () => {
  it('slices inside a shared hunk without including neighboring changes', () => {
    const sliced = sliceClusterDiff(diff, [range(2, 1, 2, 1)])
    expect(sliced).toContain('@@ -2,1 +2,1 @@\n-old one\n+new one')
    expect(sliced).not.toContain('new two')
    expect(sliced).not.toContain('old two')
  })
  it('unions parent ranges and does not duplicate overlapping children', () => {
    const sliced = sliceClusterDiff(diff, [
      range(2, 1, 2, 1),
      range(2, 1, 2, 1),
      range(4, 1, 4, 1),
    ])
    expect(sliced.match(/\+new one/g)).toHaveLength(1)
    expect(sliced).toContain('@@ -4,1 +4,1 @@\n-old two\n+new two')
  })
  it('preserves zero-line coordinates for added files and no-newline markers', () => {
    const added = `diff --git a/src/example.ts b/src/example.ts
new file mode 100644
--- /dev/null
+++ b/src/example.ts
@@ -0,0 +1,1 @@
+hello
\\ No newline at end of file
`
    expect(sliceClusterDiff(added, [range(0, 0, 1, 1)])).toBe(added)
  })
  it('preserves deletion coordinates', () => {
    const removed = `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-hello
`
    expect(sliceClusterDiff(removed, [range(1, 1, 0, 0)])).toBe(removed)
  })
  it('includes full-file rename and binary metadata', () => {
    const patch = `diff --git a/old.png b/new.png
similarity index 100%
rename from old.png
rename to new.png
`
    expect(
      sliceClusterDiff(patch, [
        { kind: 'leaf', fileName: 'new.png', fullFile: true },
      ]),
    ).toBe(patch)
    const binary =
      'diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n'
    expect(
      sliceClusterDiff(binary, [
        { kind: 'leaf', fileName: 'image.png', fullFile: true },
      ]),
    ).toBe(binary)
  })
  it('decodes quoted UTF-8 file names', () => {
    const patch =
      'diff --git "a/caf\\303\\251.png" "b/caf\\303\\251.png"\nBinary files differ\n'
    expect(
      sliceClusterDiff(patch, [
        { kind: 'leaf', fileName: 'café.png', fullFile: true },
      ]),
    ).toBe(patch)
  })
  it('fails explicitly when GitHub omitted a requested file', () => {
    expect(() => sliceClusterDiff('', [range(2, 1, 2, 1)])).toThrow(
      'incomplete',
    )
  })
})

it('uses the destination path when a renamed file’s old path is reused', () => {
  const patch = `diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
diff --git a/old.ts b/old.ts
new file mode 100644
--- /dev/null
+++ b/old.ts
@@ -0,0 +1,1 @@
+replacement
`
  const sliced = sliceClusterDiff(patch, [
    { kind: 'leaf', fileName: 'old.ts', fullFile: true },
  ])
  expect(sliced).toContain('+replacement')
  expect(sliced).not.toContain('rename to new.ts')
})
