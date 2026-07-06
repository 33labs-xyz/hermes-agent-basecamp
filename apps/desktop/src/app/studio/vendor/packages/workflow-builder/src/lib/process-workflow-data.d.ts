// Types for process-workflow-data.js, following the same pattern as
// ../../../../vendor/muapi.d.ts: a hand-written declaration sibling so this
// vendored .js module type-checks under the project's `allowJs: false`
// setting. NodeFlow.jsx (untyped JSX) imports the same module without
// needing this file; it exists for the .test.ts spec.

export interface WorkflowNode {
  id: string
  category: string
  model: string
  position?: { x?: number; y?: number }
  input_params?: Record<string, unknown>
  output_params?: { outputs?: unknown[]; resultUrl?: string | null }
}

export interface WorkflowEdge {
  id?: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface WorkflowData {
  data?: { nodes?: WorkflowNode[] }
  edges?: WorkflowEdge[]
  run_history?: Record<string, unknown[]>
  run_id?: string
  name?: string
  is_owner?: boolean
  is_published?: boolean
  show_temp_button?: boolean
  is_template?: boolean
  category?: string
}

export interface NodeSchemas {
  categories?: Record<string, unknown>
}

export interface ProcessedWorkflowState {
  nodes: unknown[]
  edges: unknown[]
  metadata: {
    workflowId?: string
    runId?: string
    workflowName?: string
    interactionMode?: boolean
    publishWorkflow?: boolean
    template: { showTemplateBtn?: boolean; isPublishedTemplate?: boolean }
    category: string
  }
}

export const edgeStyles: Record<string, { stroke: string; strokeWidth: number }>

export function getEdgeColor(
  sourceHandle?: string | null,
  targetHandle?: string | null,
  sourceNode?: unknown,
  targetNode?: unknown,
): string

export function getModelObjStatic(
  category: string,
  modelId: string | null | undefined,
  nodeSchemas: NodeSchemas | null | undefined,
): Record<string, unknown> | null

// Returns null when there is nothing restorable: no workflowData, no
// node-schema categories, or a workflowData object with no `.data.nodes`
// (the shape a failed fetch used to be coerced into upstream -- the root
// cause of the infinite-spinner bug this module fixes).
export function processWorkflowData(
  workflowData: WorkflowData | null | undefined,
  nodeSchemas: NodeSchemas | null | undefined,
  id?: string,
): ProcessedWorkflowState | null

// The restore effect's entire decision as a pure predicate: true means clear
// the "restoring" spinner (nothing to restore), false means leave it alone
// (a populated restore already happened).
export function shouldClearRestoreSpinner(initialState: unknown): boolean
