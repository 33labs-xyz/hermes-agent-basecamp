import { describe, expect, it } from 'vitest'

import type { ModelOptionProvider } from '@/types/hermes'

import { hasAuthenticatedModels } from './model-menu-helpers'

function prov(slug: string, models?: string[], extra: Partial<ModelOptionProvider> = {}): ModelOptionProvider {
  return { name: slug, slug, models, ...extra }
}

describe('hasAuthenticatedModels', () => {
  it('is false when there are no providers', () => {
    expect(hasAuthenticatedModels([])).toBe(false)
    expect(hasAuthenticatedModels(undefined)).toBe(false)
  })

  it('is false when every provider exposes zero models (unconfigured rows do not count)', () => {
    // `include_unconfigured` surfaces canonical providers the user has not set
    // up yet — empty models, authenticated:false. These must NOT register as a
    // usable model, or the composer would hide the Connect CTA behind a dead list.
    const providers = [
      prov('openai', [], { authenticated: false }),
      prov('anthropic', undefined, { authenticated: false })
    ]

    expect(hasAuthenticatedModels(providers)).toBe(false)
  })

  it('is true when at least one provider exposes a model', () => {
    const providers = [prov('openai', [], { authenticated: false }), prov('nous', ['nous/hermes-4'])]

    expect(hasAuthenticatedModels(providers)).toBe(true)
  })
})
