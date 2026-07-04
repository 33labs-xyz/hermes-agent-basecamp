import { afterEach, describe, expect, it, vi } from 'vitest'

import { $balanceProvider, resetBalanceProviderForTests, setBalanceProvider } from './balance-provider'

afterEach(() => {
  resetBalanceProviderForTests()
})

describe('balance-provider store', () => {
  it('round-trips a selected slug through localStorage', () => {
    setBalanceProvider('openrouter')

    expect($balanceProvider.get()).toBe('openrouter')
    expect(localStorage.getItem('basecamp.balanceProvider')).toBe('openrouter')
  })

  it('trims whitespace before storing', () => {
    setBalanceProvider('  muapi  ')

    expect($balanceProvider.get()).toBe('muapi')
  })

  it('clears the selection on null or empty input', () => {
    setBalanceProvider('openrouter')
    setBalanceProvider(null)

    expect($balanceProvider.get()).toBeNull()
    expect(localStorage.getItem('basecamp.balanceProvider')).toBeNull()

    setBalanceProvider('openrouter')
    setBalanceProvider('   ')

    expect($balanceProvider.get()).toBeNull()
  })

  it('hydrates the atom from a pre-existing localStorage value', async () => {
    localStorage.setItem('basecamp.balanceProvider', 'gemini')
    vi.resetModules()

    const fresh = await import('./balance-provider')

    expect(fresh.$balanceProvider.get()).toBe('gemini')
  })
})
