import { describe, expect, it } from 'vitest'

import { FEATURED_TEMPLATE_IDS, filterFeaturedTemplates } from './featured-templates'

function tpl(id: string, name = id) {
  return { id, name }
}

describe('filterFeaturedTemplates', () => {
  it('keeps only featured templates', () => {
    const [a, b] = FEATURED_TEMPLATE_IDS
    const result = filterFeaturedTemplates([tpl(a), tpl('not-featured'), tpl(b)])
    expect(result.map(t => t.id)).toEqual([a, b])
  })

  it('orders results by the featured allowlist, not input order', () => {
    const [a, b, c] = FEATURED_TEMPLATE_IDS
    const result = filterFeaturedTemplates([tpl(c), tpl(a), tpl(b)])
    expect(result.map(t => t.id)).toEqual([a, b, c])
  })

  it('skips featured ids missing from the input', () => {
    const [a, , c] = FEATURED_TEMPLATE_IDS
    const result = filterFeaturedTemplates([tpl(c), tpl(a)])
    expect(result.map(t => t.id)).toEqual([a, c])
  })

  it('returns an empty array for non-array input', () => {
    expect(filterFeaturedTemplates(null)).toEqual([])
    expect(filterFeaturedTemplates(undefined)).toEqual([])
  })

  it('ignores entries without a string id', () => {
    const [a] = FEATURED_TEMPLATE_IDS
    const result = filterFeaturedTemplates([tpl(a), { id: null }, { name: 'x' } as { id?: string }])
    expect(result.map(t => t.id)).toEqual([a])
  })

  it('does not mutate the input array', () => {
    const [a, b] = FEATURED_TEMPLATE_IDS
    const input = [tpl(b), tpl(a)]
    const snapshot = input.map(t => t.id)
    filterFeaturedTemplates(input)
    expect(input.map(t => t.id)).toEqual(snapshot)
  })

  it('dedupes by id, keeping the first occurrence', () => {
    const [a] = FEATURED_TEMPLATE_IDS
    const result = filterFeaturedTemplates([tpl(a, 'first'), tpl(a, 'second')])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('first')
  })

  it('exposes exactly eight unique curated templates', () => {
    expect(FEATURED_TEMPLATE_IDS).toHaveLength(8)
    expect(new Set(FEATURED_TEMPLATE_IDS).size).toBe(8)
  })
})
