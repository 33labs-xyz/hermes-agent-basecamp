import { describe, expect, it } from 'vitest'

import type { EnvVarInfo, ModelOptionProvider } from '@/types/hermes'

import { groupModels } from './model-menu-panel'

function provider(slug: string, name: string): ModelOptionProvider {
  return { models: [`${slug}/model-a`], name, slug }
}

const NO_SELECTION = { model: '', provider: '' }

// Minimal env map: only `is_set` matters to the configured-env filter.
function envInfo(isSet: boolean): EnvVarInfo {
  return {
    advanced: false,
    category: '',
    description: '',
    is_password: true,
    is_set: isSet,
    redacted_value: null,
    tools: [],
    url: null
  }
}

function env(entries: Record<string, boolean>): Record<string, EnvVarInfo> {
  return Object.fromEntries(Object.entries(entries).map(([key, isSet]) => [key, envInfo(isSet)]))
}

describe('groupModels ordering', () => {
  it('sorts provider groups alphabetically by name', () => {
    const groups = groupModels(
      [provider('openrouter', 'OpenRouter'), provider('nous', 'Nous')],
      '',
      NO_SELECTION,
      null,
      null
    )

    expect(groups.map(g => g.provider.slug)).toEqual(['nous', 'openrouter'])
  })

  it('pins the Claude subscription group to the bottom of the picker', () => {
    const groups = groupModels(
      [provider('openrouter', 'OpenRouter'), provider('claude-code', 'Claude subscription'), provider('nous', 'Nous')],
      '',
      NO_SELECTION,
      null,
      null
    )

    expect(groups.map(g => g.provider.slug)).toEqual(['nous', 'openrouter', 'claude-code'])
  })

  it('drops providers the user has not connected, even when they carry a catalog', () => {
    // Ambient credentials (gh CLI tokens, a Claude Code install) used to make
    // anthropic/github-copilot look pickable while their models 401'd. The
    // composer picker only lists providers the user actually connected.
    const groups = groupModels(
      [
        provider('openrouter', 'OpenRouter'),
        { ...provider('anthropic', 'Anthropic'), authenticated: false },
        { ...provider('github-copilot', 'GitHub Copilot'), authenticated: false }
      ],
      '',
      NO_SELECTION,
      null,
      null
    )

    expect(groups.map(g => g.provider.slug)).toEqual(['openrouter'])
  })

  it('keeps providers when the backend omits the authenticated flag', () => {
    const groups = groupModels([{ ...provider('nous', 'Nous'), authenticated: undefined }], '', NO_SELECTION, null, null)

    expect(groups.map(g => g.provider.slug)).toEqual(['nous'])
  })

  it('with a loaded env, keeps only providers the user set up in-app (is_set)', () => {
    // Even when the backend reports anthropic + copilot as authenticated (it
    // harvested ambient gh/ANTHROPIC creds), only OpenRouter has a key the user
    // saved in Basecamp (is_set), so it is the only pickable group.
    const groups = groupModels(
      [provider('openrouter', 'OpenRouter'), provider('anthropic', 'Anthropic'), provider('copilot', 'GitHub Copilot')],
      '',
      NO_SELECTION,
      null,
      env({ ANTHROPIC_API_KEY: false, GH_TOKEN: false, OPENROUTER_API_KEY: true })
    )

    expect(groups.map(g => g.provider.slug)).toEqual(['openrouter'])
  })

  it('with a null env, keeps every authenticated provider (fail-open)', () => {
    // Env still loading or /api/env failed: never lock the user out — fall back
    // to the authenticated-only gate.
    const groups = groupModels(
      [provider('openrouter', 'OpenRouter'), provider('anthropic', 'Anthropic')],
      '',
      NO_SELECTION,
      null,
      null
    )

    expect(groups.map(g => g.provider.slug)).toEqual(['anthropic', 'openrouter'])
  })
})
