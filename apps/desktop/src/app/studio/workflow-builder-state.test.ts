import { describe, expect, test } from 'vitest'

import { resolveWorkflowBuilderState } from './workflow-builder-state'

// A minimal node-schemas payload shaped like a successful getAllNodeSchemas
// response (the builder only needs `.categories` to be a present object).
const READY_SCHEMAS = { categories: { image: { models: {} } } }
const READY_DEF = { nodes: [], edges: [] }

describe('resolveWorkflowBuilderState', () => {
  test('returns ready when node schemas have categories and a workflow def is present', () => {
    // Arrange
    const input = { loading: false, apiKey: 'k', nodeSchemas: READY_SCHEMAS, workflowDef: READY_DEF }

    // Act
    const state = resolveWorkflowBuilderState(input)

    // Assert
    expect(state).toBe('ready')
  })

  test('ready wins even if a stale loading flag is still true', () => {
    const input = { loading: true, apiKey: 'k', nodeSchemas: READY_SCHEMAS, workflowDef: READY_DEF }
    expect(resolveWorkflowBuilderState(input)).toBe('ready')
  })

  test('returns needs-key when the api key is missing', () => {
    const input = { loading: false, apiKey: '', nodeSchemas: null, workflowDef: null }
    expect(resolveWorkflowBuilderState(input)).toBe('needs-key')
  })

  test('needs-key wins over a failed load when there is no key', () => {
    const input = { loading: false, apiKey: null, nodeSchemas: [], workflowDef: READY_DEF }
    expect(resolveWorkflowBuilderState(input)).toBe('needs-key')
  })

  test('returns loading while a keyed fetch is in flight', () => {
    const input = { loading: true, apiKey: 'k', nodeSchemas: null, workflowDef: null }
    expect(resolveWorkflowBuilderState(input)).toBe('loading')
  })

  test('returns loading before the fetch settles even when loading flag is false', () => {
    const input = { loading: false, apiKey: 'k', nodeSchemas: null, workflowDef: null }
    expect(resolveWorkflowBuilderState(input)).toBe('loading')
  })

  test('returns load-failed when node schemas came back as an empty array', () => {
    // getAllNodeSchemas rejection path sets nodeSchemas to [].
    const input = { loading: false, apiKey: 'k', nodeSchemas: [], workflowDef: READY_DEF }
    expect(resolveWorkflowBuilderState(input)).toBe('load-failed')
  })

  test('returns load-failed when node schemas object has no categories', () => {
    const input = { loading: false, apiKey: 'k', nodeSchemas: { detail: 'nope' }, workflowDef: READY_DEF }
    expect(resolveWorkflowBuilderState(input)).toBe('load-failed')
  })
})
