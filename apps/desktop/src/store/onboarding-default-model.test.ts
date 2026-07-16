import { afterEach, describe, expect, it, vi } from 'vitest'

// IMPORTANT: mock the SAME module specifier onboarding.ts imports these from.
// Check the import line at the top of onboarding.ts (likely '@/hermes' or
// '../hermes') and use it verbatim here.
vi.mock('@/hermes', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hermes')>()

  return {
    ...actual,
    getGlobalModelOptions: vi.fn(),
    getRecommendedDefaultModel: vi.fn()
  }
})

import { getGlobalModelOptions, getRecommendedDefaultModel } from '@/hermes'

import { fetchProviderDefaultModel, fetchRecommendedDefaultModel } from './onboarding'

const mockRecommended = vi.mocked(getRecommendedDefaultModel)
const mockOptions = vi.mocked(getGlobalModelOptions)

afterEach(() => {
  mockRecommended.mockReset()
  mockOptions.mockReset()
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

describe('fetchProviderDefaultModel cold-catalog fallback', () => {
  it('falls back to recommended-default when options returns zero providers', async () => {
    mockOptions.mockResolvedValueOnce({ providers: [] } as never)
    mockRecommended.mockResolvedValueOnce({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-5',
      free_tier: null
    })

    const result = await fetchProviderDefaultModel(['openrouter'])

    expect(result).toEqual({ providerSlug: 'openrouter', defaultModel: 'anthropic/claude-sonnet-5' })
  })

  it('falls back to recommended-default when the options call throws', async () => {
    mockOptions.mockRejectedValueOnce(new Error('network'))
    mockRecommended.mockResolvedValueOnce({ provider: 'openrouter', model: 'x/y', free_tier: null })

    const result = await fetchProviderDefaultModel(['openrouter'])

    expect(result).toEqual({ providerSlug: 'openrouter', defaultModel: 'x/y' })
  })

  it('returns null only when both options and recommended-default fail', async () => {
    mockOptions.mockResolvedValueOnce({ providers: [] } as never)
    mockRecommended.mockResolvedValueOnce({ provider: 'openrouter', model: '', free_tier: null })

    const result = await fetchProviderDefaultModel(['openrouter'])

    expect(result).toBeNull()
  })
})
