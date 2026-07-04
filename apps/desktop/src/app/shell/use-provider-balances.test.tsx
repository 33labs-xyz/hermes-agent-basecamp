import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $studioKey, resetStudioKeyForTests } from '@/store/studio-key'
import type { EnvVarInfo } from '@/types/hermes'

const envMock = vi.hoisted(() => ({ value: {} as Record<string, EnvVarInfo> }))
const studioBalanceMock = vi.hoisted(() => ({ value: null as number | null }))

vi.mock('@/hermes', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hermes')>()

  return { ...actual, getEnvVars: vi.fn(async () => envMock.value) }
})

vi.mock('../studio/use-studio-balance', () => ({
  useStudioBalance: () => studioBalanceMock.value,
  formatCredits: (b: number) => String(b)
}))

import { assembleConfiguredProviders, useProviderBalances } from './use-provider-balances'

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return createElement(QueryClientProvider, { client }, children)
}

const provider = (over: Partial<EnvVarInfo>): EnvVarInfo =>
  ({ advanced: false, category: 'provider', description: '', is_password: true, is_set: true, redacted_value: null, tools: [], url: null, ...over })

afterEach(() => {
  resetStudioKeyForTests()
  studioBalanceMock.value = null
  vi.clearAllMocks()
  delete (window as { hermesDesktop?: unknown }).hermesDesktop
})

describe('assembleConfiguredProviders', () => {
  it('keeps set provider-category vars that map to a known group', () => {
    expect(assembleConfiguredProviders({ OPENROUTER_API_KEY: provider({}) })).toEqual([
      { slug: 'openrouter', label: 'OpenRouter' }
    ])
  })

  it('skips unset, non-provider, and unknown-group entries', () => {
    const result = assembleConfiguredProviders({
      OPENROUTER_API_KEY: provider({ is_set: false }),
      SOME_TOOL_TOKEN: provider({ category: 'tool' }),
      MYSTERY_API_KEY: provider({})
    })

    expect(result).toEqual([])
  })

  it('dedupes provider aliases onto one slug (first label wins)', () => {
    const result = assembleConfiguredProviders({
      GOOGLE_API_KEY: provider({}),
      GEMINI_API_KEY: provider({})
    })

    expect(result).toEqual([{ slug: 'gemini', label: 'Gemini' }])
  })

  it('returns [] for undefined input', () => {
    expect(assembleConfiguredProviders(undefined)).toEqual([])
  })
})

describe('useProviderBalances', () => {
  it('assembles OpenRouter + Muapi rows, ok balances, ok sorted first', async () => {
    envMock.value = { OPENROUTER_API_KEY: provider({}) }
    studioBalanceMock.value = 900
    ;(window as { hermesDesktop?: unknown }).hermesDesktop = {
      providerBalance: vi.fn(async () => ({ balance: 12, status: 'ok' as const }))
    }
    $studioKey.set('sk-muapi')

    const { result } = renderHook(() => useProviderBalances(), { wrapper })

    await waitFor(() => {
      expect(result.current.find(r => r.slug === 'openrouter')?.status).toBe('ok')
    })

    expect(result.current.find(r => r.slug === 'openrouter')).toMatchObject({ status: 'ok', balance: 12 })
    expect(result.current.find(r => r.slug === 'muapi')).toMatchObject({ status: 'ok', balance: 900 })
    expect(result.current.every(r => r.status === 'ok')).toBe(true)
  })
})
