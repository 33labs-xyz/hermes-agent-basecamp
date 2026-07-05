// Pure decision helper for the Workflow builder's mount gate.
//
// WorkflowStudio loads three things before it can mount the node-canvas:
// the workflow definition and the node schemas (which carry the palette of
// node `categories`). The old gate mounted the canvas whenever nodeSchemas
// was truthy, but the failure path sets nodeSchemas to `[]` (an empty array
// is truthy), so a failed schema fetch mounted a canvas that could never
// render and spun "Loading Builder..." forever. This resolver turns the raw
// load inputs into one of four explicit states so the UI can show an
// actionable message instead of an infinite spinner.

export type WorkflowBuilderState = 'loading' | 'needs-key' | 'load-failed' | 'ready'

export interface WorkflowBuilderStateInput {
  // True while loadWorkflowDetails is in flight.
  loading: boolean
  // Muapi key from Settings; empty/null means the user has not added one.
  apiKey: string | null | undefined
  // getAllNodeSchemas result: {categories:{...}} on success, [] on failure,
  // null before the fetch has settled.
  nodeSchemas: unknown
  // Workflow definition: an object once loaded, null before.
  workflowDef: unknown
}

// The node canvas can only render when the schemas carry a `categories`
// object. Matches NodeFlow's own `nodeSchemas?.categories` gate so this
// resolver and the canvas agree on what "renderable" means. An array (the
// failure default) has no categories, so it reads as not-ready.
function hasNodeCategories(nodeSchemas: unknown): boolean {
  if (nodeSchemas === null || typeof nodeSchemas !== 'object' || Array.isArray(nodeSchemas)) {
    return false
  }
  const categories = (nodeSchemas as { categories?: unknown }).categories
  return categories !== null && typeof categories === 'object'
}

export function resolveWorkflowBuilderState({
  loading,
  apiKey,
  nodeSchemas,
  workflowDef,
}: WorkflowBuilderStateInput): WorkflowBuilderState {
  // Ready dominates: if both inputs are usable the canvas mounts even if a
  // stale loading flag has not cleared yet.
  if (hasNodeCategories(nodeSchemas) && workflowDef !== null && workflowDef !== undefined) {
    return 'ready'
  }
  // No key means the fetch never had a chance; steer the user to Settings
  // before surfacing any load failure.
  if (!apiKey) {
    return 'needs-key'
  }
  // Still fetching, or the fetch has not populated either input yet.
  if (loading || (nodeSchemas === null && (workflowDef === null || workflowDef === undefined))) {
    return 'loading'
  }
  // Keyed, settled, but the schemas came back empty or without categories.
  return 'load-failed'
}
