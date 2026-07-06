import { describe, expect, it } from 'vitest'

import { isFileDeleteOk, isLocallyDeletable, planArtifactDeletion } from './artifact-deletion'
import type { DeletableArtifact } from './artifact-deletion'

function makeArtifact(overrides: Partial<DeletableArtifact> = {}): DeletableArtifact {
  return {
    id: 'artifact-1',
    kind: 'file',
    value: '/Users/test/project/output.txt',
    ...overrides
  }
}

describe('planArtifactDeletion', () => {
  it('resolves a studio artifact with a well-formed id to a studio plan', () => {
    const artifact = makeArtifact({ id: 'studio:abc', source: 'studio' })

    const result = planArtifactDeletion(artifact)

    expect(result).toEqual({ kind: 'studio', genId: 'abc' })
  })

  it('returns null for a studio artifact with a malformed id (no studio: prefix)', () => {
    const artifact = makeArtifact({ id: 'abc', source: 'studio' })

    const result = planArtifactDeletion(artifact)

    expect(result).toBeNull()
  })

  it('returns null for a studio artifact whose id is exactly the prefix (empty genId)', () => {
    const artifact = makeArtifact({ id: 'studio:', source: 'studio' })

    const result = planArtifactDeletion(artifact)

    expect(result).toBeNull()
  })

  it('resolves a local absolute file to a file plan', () => {
    const artifact = makeArtifact({ id: 'a', kind: 'file', value: '/Users/x/a.png' })

    const result = planArtifactDeletion(artifact)

    expect(result).toEqual({ kind: 'file', path: '/Users/x/a.png' })
  })

  it('resolves a local ~/ image to a file plan', () => {
    const artifact = makeArtifact({ id: 'a', kind: 'image', value: '~/a.png' })

    const result = planArtifactDeletion(artifact)

    expect(result).toEqual({ kind: 'file', path: '~/a.png' })
  })

  it('resolves a file:// value to a file plan', () => {
    const artifact = makeArtifact({ id: 'a', kind: 'file', value: 'file:///Users/x/a.png' })

    const result = planArtifactDeletion(artifact)

    expect(result).toEqual({ kind: 'file', path: 'file:///Users/x/a.png' })
  })

  it('returns null for a remote https image', () => {
    const artifact = makeArtifact({ id: 'a', kind: 'image', value: 'https://x/a.png' })

    const result = planArtifactDeletion(artifact)

    expect(result).toBeNull()
  })

  it('returns null for a link kind regardless of value shape', () => {
    const artifact = makeArtifact({ id: 'a', kind: 'link', value: '/Users/x/a.png' })

    const result = planArtifactDeletion(artifact)

    expect(result).toBeNull()
  })

  it('returns null for a data: uri', () => {
    const artifact = makeArtifact({ id: 'a', kind: 'image', value: 'data:image/png;base64,abc123' })

    const result = planArtifactDeletion(artifact)

    expect(result).toBeNull()
  })

  it('returns null for a relative path', () => {
    const artifact = makeArtifact({ id: 'a', kind: 'file', value: './out.png' })

    const result = planArtifactDeletion(artifact)

    expect(result).toBeNull()
  })

  it('does not mutate the input artifact', () => {
    const artifact = makeArtifact({ id: 'a', kind: 'file', value: '/Users/x/a.png' })
    const snapshot = { ...artifact }

    planArtifactDeletion(artifact)

    expect(artifact).toEqual(snapshot)
  })
})

describe('isLocallyDeletable', () => {
  it('returns true for an absolute path starting with /', () => {
    expect(isLocallyDeletable('/Users/x/a.png')).toBe(true)
  })

  it('returns true for a ~/ path', () => {
    expect(isLocallyDeletable('~/a.png')).toBe(true)
  })

  it('returns true for a file:// url', () => {
    expect(isLocallyDeletable('file:///Users/x/a.png')).toBe(true)
  })

  it('returns false for a relative ./ path', () => {
    expect(isLocallyDeletable('./out.png')).toBe(false)
  })

  it('returns false for a relative ../ path', () => {
    expect(isLocallyDeletable('../out.png')).toBe(false)
  })

  it('returns false for an https:// url', () => {
    expect(isLocallyDeletable('https://x/a.png')).toBe(false)
  })

  it('returns false for a data: uri', () => {
    expect(isLocallyDeletable('data:image/png;base64,abc123')).toBe(false)
  })
})

describe('isFileDeleteOk', () => {
  it('is true only for an explicit ok result', () => {
    expect(isFileDeleteOk({ ok: true })).toBe(true)
  })
  it('is false when the bridge returned nothing (undefined)', () => {
    expect(isFileDeleteOk(undefined)).toBe(false)
  })
  it('is false for an explicit failure', () => {
    expect(isFileDeleteOk({ ok: false, error: 'nope' })).toBe(false)
  })
  it('is false for a malformed result missing ok', () => {
    expect(isFileDeleteOk({} as { ok?: boolean })).toBe(false)
  })
})
