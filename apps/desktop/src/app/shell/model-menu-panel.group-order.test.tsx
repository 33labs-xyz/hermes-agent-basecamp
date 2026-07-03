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
})
