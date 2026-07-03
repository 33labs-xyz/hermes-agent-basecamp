import { describe, expect, it } from 'vitest'

import type { ModelOptionProvider } from '@/types/hermes'

import { groupModels } from './model-menu-panel'

function provider(slug: string, name: string): ModelOptionProvider {
  return { models: [`${slug}/model-a`], name, slug }
}

const NO_SELECTION = { model: '', provider: '' }

describe('groupModels ordering', () => {
  it('sorts provider groups alphabetically by name', () => {
    const groups = groupModels([provider('openrouter', 'OpenRouter'), provider('nous', 'Nous')], '', NO_SELECTION, null)

    expect(groups.map(g => g.provider.slug)).toEqual(['nous', 'openrouter'])
  })

  it('pins the Claude subscription group to the bottom of the picker', () => {
    const groups = groupModels(
      [provider('openrouter', 'OpenRouter'), provider('claude-code', 'Claude subscription'), provider('nous', 'Nous')],
      '',
      NO_SELECTION,
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
      null
    )

    expect(groups.map(g => g.provider.slug)).toEqual(['openrouter'])
  })

  it('keeps providers when the backend omits the authenticated flag', () => {
    const groups = groupModels([{ ...provider('nous', 'Nous'), authenticated: undefined }], '', NO_SELECTION, null)

    expect(groups.map(g => g.provider.slug)).toEqual(['nous'])
  })
})
