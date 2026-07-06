// Pure filter that hides Artifacts tiles whose local on-disk file no longer
// exists. Chat-scraped artifact records (regex-extracted from message text)
// get no filesystem existence check at collection time, so a deleted local
// file still produces an empty-shell tile. Studio artifacts are unaffected —
// they already come pre-filtered by `fs.existsSync` in studio.cjs.
//
// `existsMap` is built from a single batch IPC call (one round trip for the
// whole refresh, not one per file). Rule set:
//   - local on-disk kinds ('file' | 'image'): keep only when existsMap[value]
//     is exactly `true`.
//   - non-file kinds ('link'): always pass through untouched — they're
//     remote URLs, not disk paths, so existence is meaningless for them.
//   - a value ABSENT from existsMap: pass through (fail-open). A missing
//     entry means the existence check didn't run or didn't cover this path
//     (e.g. IPC failure upstream) — never let an inconclusive check hide a
//     real artifact.
// Immutable: returns a new array; never mutates `records` or its entries.

export type ExistenceCheckableArtifactKind = 'file' | 'image' | 'link'

export interface ExistenceCheckableArtifact {
  id: string
  kind: ExistenceCheckableArtifactKind
  value: string
}

const LOCAL_FILE_KINDS: ReadonlySet<ExistenceCheckableArtifactKind> = new Set(['file', 'image'])

export function filterExistingArtifacts<T extends ExistenceCheckableArtifact>(
  records: readonly T[],
  existsMap: Readonly<Record<string, boolean>>
): T[] {
  return records.filter(record => {
    if (!LOCAL_FILE_KINDS.has(record.kind)) {
      return true
    }

    const known = existsMap[record.value]

    return known !== false
  })
}
