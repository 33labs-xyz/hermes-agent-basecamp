import { describe, expect, it } from 'vitest'

import { filterExistingArtifacts } from './filter-existing-artifacts'
import type { ExistenceCheckableArtifact } from './filter-existing-artifacts'

function makeArtifact(overrides: Partial<ExistenceCheckableArtifact> = {}): ExistenceCheckableArtifact {
  return {
    id: 'artifact-1',
    kind: 'file',
    value: '/Users/test/project/output.txt',
    ...overrides
  }
}

describe('filterExistingArtifacts', () => {
  it('drops a local file record whose path maps to false', () => {
    const records = [makeArtifact({ id: 'a', kind: 'file', value: '/tmp/missing.txt' })]

    const result = filterExistingArtifacts(records, { '/tmp/missing.txt': false })

    expect(result).toHaveLength(0)
  })

  it('drops a local image record whose path maps to false', () => {
    const records = [makeArtifact({ id: 'a', kind: 'image', value: '/tmp/missing.png' })]

    const result = filterExistingArtifacts(records, { '/tmp/missing.png': false })

    expect(result).toHaveLength(0)
  })

  it('keeps a local record whose path maps to true', () => {
    const records = [makeArtifact({ id: 'a', kind: 'file', value: '/tmp/present.txt' })]

    const result = filterExistingArtifacts(records, { '/tmp/present.txt': true })

    expect(result).toEqual(records)
  })

  it('passes through a url/link record regardless of existsMap', () => {
    const records = [makeArtifact({ id: 'a', kind: 'link', value: 'https://example.com/page' })]

    const result = filterExistingArtifacts(records, { 'https://example.com/page': false })

    expect(result).toEqual(records)
  })

  it('passes through a record whose path is absent from existsMap (fail-open)', () => {
    const records = [makeArtifact({ id: 'a', kind: 'file', value: '/tmp/unchecked.txt' })]

    const result = filterExistingArtifacts(records, {})

    expect(result).toEqual(records)
  })

  it('returns a new array and does not mutate the input array or its records', () => {
    const records = [
      makeArtifact({ id: 'a', kind: 'file', value: '/tmp/present.txt' }),
      makeArtifact({ id: 'b', kind: 'file', value: '/tmp/missing.txt' })
    ]
    const recordsSnapshot = [...records]
    const existsMap = { '/tmp/missing.txt': false, '/tmp/present.txt': true }

    const result = filterExistingArtifacts(records, existsMap)

    expect(result).not.toBe(records)
    expect(records).toEqual(recordsSnapshot)
    expect(records).toHaveLength(2)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(records[0])
  })

  it('handles a mix of file, image, and link kinds in one batch', () => {
    const records = [
      makeArtifact({ id: 'keep-file', kind: 'file', value: '/tmp/keep.txt' }),
      makeArtifact({ id: 'drop-file', kind: 'file', value: '/tmp/drop.txt' }),
      makeArtifact({ id: 'keep-image', kind: 'image', value: '/tmp/keep.png' }),
      makeArtifact({ id: 'drop-image', kind: 'image', value: '/tmp/drop.png' }),
      makeArtifact({ id: 'link', kind: 'link', value: 'https://example.com' })
    ]
    const existsMap = {
      '/tmp/keep.txt': true,
      '/tmp/drop.txt': false,
      '/tmp/keep.png': true,
      '/tmp/drop.png': false
    }

    const result = filterExistingArtifacts(records, existsMap)

    expect(result.map(record => record.id)).toEqual(['keep-file', 'keep-image', 'link'])
  })
})
