import type { StudioGenerationEntry } from '@/global'

// Saved Studio generations, filtered to pickable reference images (active,
// image-kind, on-disk) and ordered newest-first, then capped for the picker
// grid. Pure and immutable: never mutates the input array.
export function libraryImageEntries(
  entries: readonly StudioGenerationEntry[] | null | undefined,
  cap = 60,
): StudioGenerationEntry[] {
  if (!Array.isArray(entries)) {
    return []
  }
  return entries
    .filter((e) => e && e.kind === 'image' && !e.archived && typeof e.path === 'string')
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, Math.max(0, cap))
}
