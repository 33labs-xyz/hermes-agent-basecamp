import { describe, expect, test } from 'vitest'

import { processWorkflowData, shouldClearRestoreSpinner } from './process-workflow-data'

// A minimal node-schemas payload shaped like a successful getAllNodeSchemas
// response (only `.categories` needs to be a present object for the gate).
const READY_SCHEMAS = { categories: {} }

describe('processWorkflowData', () => {
  test('returns null for a truthy def with no .data (the shape a FAILED fetch used to be coerced into)', () => {
    // Arrange: exactly the fake fallback object WorkflowStudio used to set on
    // a rejected getWorkflowData -- truthy, but no `.data.nodes` to restore.
    const workflowData = { nodes: [], edges: [] }

    // Act
    const result = processWorkflowData(workflowData, READY_SCHEMAS, 'w1')

    // Assert
    expect(result).toBeNull()
  })

  test('returns a restorable object when .data.nodes is present, even if empty', () => {
    // Arrange: an empty-but-valid definition (a genuinely blank workflow).
    const workflowData = { data: { nodes: [] } }

    // Act
    const result = processWorkflowData(workflowData, READY_SCHEMAS, 'w1')

    // Assert
    expect(result).not.toBeNull()
    // Non-null assertion: the line above is the actual runtime check: TS
    // control-flow narrowing does not see through vitest's `.not.toBeNull()`
    // as a type guard, so this is a type-only annotation, not a new
    // assumption.
    expect(result!.nodes).toEqual([])
  })

  test('returns null when workflowData is null', () => {
    // Arrange / Act
    const result = processWorkflowData(null, READY_SCHEMAS, 'w1')

    // Assert
    expect(result).toBeNull()
  })

  test('returns null when node schemas have no categories', () => {
    // Arrange: a populated def, but the schema fetch never resolved.
    const workflowData = { data: { nodes: [] } }

    // Act
    const result = processWorkflowData(workflowData, null, 'w1')

    // Assert
    expect(result).toBeNull()
  })
})

describe('shouldClearRestoreSpinner', () => {
  test('clears the spinner when there is nothing to restore (null initialState)', () => {
    // Arrange: blank/new workflow, empty def, or a failed fetch -- all
    // resolve to a null initialState from processWorkflowData.
    const initialState = null

    // Act
    const result = shouldClearRestoreSpinner(initialState)

    // Assert
    expect(result).toBe(true)
  })

  test('leaves the spinner state alone once a restore already happened', () => {
    // Arrange: processWorkflowData produced a populated object, so isRestoring
    // was already initialized to false -- the effect must not touch it.
    const initialState = { nodes: [], edges: [] }

    // Act
    const result = shouldClearRestoreSpinner(initialState)

    // Assert
    expect(result).toBe(false)
  })
})
