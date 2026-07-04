// Curated Muapi workflow templates surfaced in the Studio Workflows tab.
//
// The full template catalog ships 48+ workflows, many of them multi-model
// graphs that fail to render in the vendored builder. This allowlist narrows
// the Templates tab to a small, hand-verified set (simplest graphs, data path
// confirmed). Order matters - the tab renders templates in this order.
//
// Maintenance: if a template blank-screens in the app, delete its id here. If
// an id disappears upstream it simply drops off (skip-if-missing) rather than
// erroring. Strings stay plain English, matching the rest of the Studio surface
// (no i18n).
export const FEATURED_TEMPLATE_IDS: readonly string[] = [
  '63d42ee7-be47-4bbc-83f0-001d195a263f', // Logo transformer (Nano Banana 2)
  '0fabec51-5639-4d2c-b388-91aff25bc8a2', // Product Mockup (Nano Banana)
  '6b41af09-a40f-459f-8179-7ee3a90d300b', // Fashion Headshots (Flux 2 Pro)
  'e2cf2d9d-b70e-4f2f-93f8-31c36dd94e38', // Home Decor Designer (Nano Banana)
  '0849ffba-248d-4608-b480-d0a7958d825f', // Action Figure (Nano Banana 2)
  '4e498fd2-6b24-42b5-80d4-c5fd090eeaae', // Paper Cutting Art (Seedream v5)
  '23503b41-52b8-4055-a8db-ca9b21e51d95', // Sculpture Maker (Nano Banana 2)
  'a4f87ada-dbb3-4932-b209-6f1a222ce872' // Keyboard Art (Ideogram v3)
]

interface TemplateLike {
  id?: string | null
}

// Returns a new array holding only the featured templates present in `list`,
// ordered to match FEATURED_TEMPLATE_IDS. Missing ids are skipped, duplicate
// ids keep their first occurrence, and non-array input yields an empty array.
// Never mutates the input.
export function filterFeaturedTemplates<T extends TemplateLike>(
  list: readonly T[] | null | undefined
): T[] {
  if (!Array.isArray(list)) {
    return []
  }

  const byId = new Map<string, T>()

  for (const item of list) {
    if (item && typeof item.id === 'string' && !byId.has(item.id)) {
      byId.set(item.id, item)
    }
  }

  return FEATURED_TEMPLATE_IDS.map(id => byId.get(id)).filter((item): item is T => item !== undefined)
}
