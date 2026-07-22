import { describe, expect, it } from 'vitest'

import { extractComposerDropCandidates } from './composer-drop'

// Build a minimal DataTransfer stand-in. jsdom's DataTransfer doesn't accept
// synthetic File entries, so we fake just the surface dragHasAttachments +
// extractDroppedFiles read: types, files, items.
function makeTransfer({
  types = [] as string[],
  files = [] as File[],
  pathsData
}: {
  types?: string[]
  files?: File[]
  pathsData?: string
}): DataTransfer {
  const fileList = {
    ...files,
    length: files.length,
    item: (i: number) => files[i] ?? null
  }

  return {
    types,
    files: fileList as unknown as FileList,
    items: files.map(file => ({ kind: 'file', getAsFile: () => file })) as unknown as DataTransferItemList,
    getData: (mime: string) => (mime === 'application/x-hermes-paths' ? (pathsData ?? '') : '')
  } as unknown as DataTransfer
}

describe('extractComposerDropCandidates', () => {
  it('returns null for a text-only drag (no attachments) so the textarea keeps it', () => {
    const transfer = makeTransfer({ types: ['text/plain'] })

    expect(extractComposerDropCandidates(transfer)).toBeNull()
  })

  it('returns candidates for a Finder image drop', () => {
    const image = new File(['x'], 'logowaiff2026.png', { type: 'image/png' })
    const transfer = makeTransfer({ types: ['Files'], files: [image] })

    const candidates = extractComposerDropCandidates(transfer)

    expect(candidates).not.toBeNull()
    expect(candidates).toHaveLength(1)
    expect(candidates?.[0]?.file).toBe(image)
  })

  it('returns null when a drag advertises files but carries none', () => {
    const transfer = makeTransfer({ types: ['Files'], files: [] })

    expect(extractComposerDropCandidates(transfer)).toBeNull()
  })
})
