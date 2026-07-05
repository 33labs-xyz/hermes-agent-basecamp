import { describe, expect, it } from 'vitest'

import type { StudioGenerationEntry } from '@/global'

import { libraryImageEntries } from './library-images'

// Build a StudioGenerationEntry with sensible defaults; override per case.
function entry(overrides: Partial<StudioGenerationEntry>): StudioGenerationEntry {
  return {
    id: 'id',
    ext: 'png',
    kind: 'image',
    folder: '',
    prompt: '',
    model: '',
    tab: '',
    sourceUrl: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    archived: false,
    path: '/x/id.png',
    ...overrides,
  }
}

describe('libraryImageEntries', () => {
  it('keeps active, on-disk image entries', () => {
    const result = libraryImageEntries([entry({ id: 'a' })])
    expect(result.map((e) => e.id)).toEqual(['a'])
  })

  it('orders newest first by createdAt', () => {
    const older = entry({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' })
    const newer = entry({ id: 'new', createdAt: '2026-06-01T00:00:00.000Z' })
    const result = libraryImageEntries([older, newer])
    expect(result.map((e) => e.id)).toEqual(['new', 'old'])
  })

  it('drops archived, non-image, and path-less entries', () => {
    const good = entry({ id: 'good' })
    const archived = entry({ id: 'arch', archived: true })
    const video = entry({ id: 'vid', kind: 'video' })
    const noPath = entry({ id: 'nopath', path: undefined })
    const result = libraryImageEntries([good, archived, video, noPath])
    expect(result.map((e) => e.id)).toEqual(['good'])
  })

  it('caps the result length (default 60, explicit override)', () => {
    const many = Array.from({ length: 70 }, (_, i) =>
      entry({ id: `e${i}`, createdAt: `2026-01-01T00:00:00.${String(i).padStart(3, '0')}Z` }),
    )
    expect(libraryImageEntries(many)).toHaveLength(60)
    expect(libraryImageEntries(many, 5)).toHaveLength(5)
  })

  it('returns [] for null, undefined, and non-array input', () => {
    expect(libraryImageEntries(null)).toEqual([])
    expect(libraryImageEntries(undefined)).toEqual([])
    // @ts-expect-error - exercising the runtime non-array guard
    expect(libraryImageEntries('nope')).toEqual([])
  })

  it('does not mutate the input array', () => {
    const input = [
      entry({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }),
      entry({ id: 'b', createdAt: '2026-06-01T00:00:00.000Z' }),
    ]
    const snapshot = input.map((e) => e.id)
    libraryImageEntries(input)
    expect(input.map((e) => e.id)).toEqual(snapshot)
  })
})
