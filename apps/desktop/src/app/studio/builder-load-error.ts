// Pure predicate for WorkflowStudio's partial-load error gate. Extracted from
// loadWorkflowDetails so the null-safety of the guard is unit-testable without
// rendering the heavy vendored WorkflowStudio component. `workflowDef` is null
// when getWorkflowData rejected, so every property access here must be
// null-safe -- the previous inline guard `def.nodes?.length` dereferenced
// `def.nodes` on a null `def` and threw a TypeError on the lone-getWorkflowData-
// rejection path.
export function shouldShowBuilderLoadError(
  nodeSchemas: { length?: number } | null | undefined,
  workflowDef: Record<string, unknown> | null | undefined,
): boolean {
  const nodes = (workflowDef as { nodes?: { length?: number } } | null | undefined)?.nodes
  return !nodeSchemas?.length && !nodes?.length
}
