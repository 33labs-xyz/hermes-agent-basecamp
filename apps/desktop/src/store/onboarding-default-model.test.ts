import { afterEach, describe, expect, it, vi } from 'vitest'

// IMPORTANT: mock the SAME module specifier onboarding.ts imports these from.
// Check the import line at the top of onboarding.ts (likely '@/hermes' or
// '../hermes') and use it verbatim here.
vi.mock('@/hermes', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hermes')>()

  return {
    ...actual,
    getRecommendedDefaultModel: vi.fn()
  }
})

import { getRecommendedDefaultModel } from '@/hermes'
import { fetchRecommendedDefaultModel } from './onboarding'

const mockRecommended = vi.mocked(getRecommendedDefaultModel)

afterEach(() => {
  mockRecommended.mockReset()
})

describe('fetchRecommendedDefaultModel', () => {
  it('returns the first slug whose recommended model is non-empty', async () => {
    mockRecommended.mockResolvedValueOnce({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-5',
      free_tier: null
    })

    const result = await fetchRecommendedDefaultModel(['openrouter'])

    expect(result).toEqual({ providerSlug: 'openrouter', defaultModel: 'anthropic/claude-sonnet-5' })
    expect(mockRecommended).toHaveBeenCalledWith('openrouter')
  })

  it('skips a slug whose recommended model is empty and tries the next', async () => {
    mockRecommended
      .mockResolvedValueOnce({ provider: 'bogus', model: '', free_tier: null })
      .mockResolvedValueOnce({ provider: 'openrouter', model: 'x/y', free_tier: null })

    const result = await fetchRecommendedDefaultModel(['bogus', 'openrouter'])

    expect(result).toEqual({ providerSlug: 'openrouter', defaultModel: 'x/y' })
  })

  it('skips a slug whose call rejects and tries the next', async () => {
    mockRecommended
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ provider: 'openrouter', model: 'x/y', free_tier: null })

    const result = await fetchRecommendedDefaultModel(['openrouter', 'openrouter'])

    expect(result).toEqual({ providerSlug: 'openrouter', defaultModel: 'x/y' })
  })

  it('ignores blank slugs', async () => {
    mockRecommended.mockResolvedValueOnce({ provider: 'openrouter', model: 'x/y', free_tier: null })

    const result = await fetchRecommendedDefaultModel(['', '  ', 'openrouter'])

    expect(result).toEqual({ providerSlug: 'openrouter', defaultModel: 'x/y' })
    expect(mockRecommended).toHaveBeenCalledTimes(1)
    expect(mockRecommended).toHaveBeenCalledWith('openrouter')
  })

  it('returns null when every slug is empty or throws', async () => {
    mockRecommended
      .mockResolvedValueOnce({ provider: 'a', model: '', free_tier: null })
      .mockRejectedValueOnce(new Error('nope'))

    const result = await fetchRecommendedDefaultModel(['a', 'b'])

    expect(result).toBeNull()
  })
})
