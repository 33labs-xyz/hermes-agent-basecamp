import { describe, expect, test } from 'vitest'

import { shouldShowBuilderLoadError } from './builder-load-error'

describe('shouldShowBuilderLoadError', () => {
  test('returns true and does not throw on the lone-getWorkflowData-rejection path', () => {
    // Arrange: schemas came back empty/failed to [], def is null (rejected getWorkflowData).
    // Act / Assert
    expect(() => shouldShowBuilderLoadError([], null)).not.toThrow()
    expect(shouldShowBuilderLoadError([], null)).toBe(true)
  })

  test('returns false when node schemas are present, even with def null', () => {
    const input = [{ id: 'x' }]
    expect(() => shouldShowBuilderLoadError(input, null)).not.toThrow()
    expect(shouldShowBuilderLoadError(input, null)).toBe(false)
  })

  test('returns false when def carries nodes', () => {
    expect(shouldShowBuilderLoadError([], { nodes: [{}] })).toBe(false)
  })

  test('returns true when def object is present but has no top-level nodes', () => {
    expect(shouldShowBuilderLoadError([], { data: { nodes: [] } })).toBe(true)
  })

  test('returns true and does not throw when def is undefined', () => {
    expect(() => shouldShowBuilderLoadError([], undefined)).not.toThrow()
    expect(shouldShowBuilderLoadError([], undefined)).toBe(true)
  })
})
