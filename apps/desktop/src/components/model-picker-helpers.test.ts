import { describe, expect, it } from 'vitest'

import type { EnvVarInfo, ModelOptionProvider } from '@/types/hermes'

import { pickableProviders } from './model-picker-helpers'

function prov(slug: string, models?: string[]): ModelOptionProvider {
  return { models, name: slug, slug }
}

// Minimal env map: only `is_set` matters to the configured-env filter.
function env(entries: Record<string, boolean>): Record<string, EnvVarInfo> {
  const info = (isSet: boolean): EnvVarInfo => ({
    advanced: false,
    category: '',
    description: '',
    is_password: true,
    is_set: isSet,
    redacted_value: null,
    tools: [],
    url: null
  })

  return Object.fromEntries(Object.entries(entries).map(([key, isSet]) => [key, info(isSet)]))
}

describe('pickableProviders', () => {
  it('keeps only providers that carry a model catalog', () => {
    const providers = [prov('openrouter', ['openrouter/model-a']), prov('empty', []), prov('none')]

    expect(pickableProviders(providers, null).map(p => p.slug)).toEqual(['openrouter'])
  })

  it('with a loaded env, keeps only providers the user set up in-app (is_set)', () => {
    // Backend harvested ambient gh/ANTHROPIC creds, so anthropic + copilot carry
    // catalogs, but only OpenRouter has a key the user saved in Basecamp.
    const providers = [
      prov('openrouter', ['openrouter/model-a']),
      prov('anthropic', ['claude-4-opus']),
      prov('copilot', ['gpt-5'])
    ]

    const result = pickableProviders(providers, env({ ANTHROPIC_API_KEY: false, GH_TOKEN: false, OPENROUTER_API_KEY: true }))

    expect(result.map(p => p.slug)).toEqual(['openrouter'])
  })

  it('with a null env, falls open to the catalog-only filter (never empties the list)', () => {
    // Env still loading or /api/env failed: keep every provider that has models,
    // so the user is never locked out of switching.
    const providers = [prov('openrouter', ['openrouter/model-a']), prov('anthropic', ['claude-4-opus'])]

    expect(pickableProviders(providers, null).map(p => p.slug)).toEqual(['openrouter', 'anthropic'])
  })
})
