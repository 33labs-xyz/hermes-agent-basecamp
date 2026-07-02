import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as OnboardingStore from '@/store/onboarding'
import type { ModelOptionProvider } from '@/types/hermes'

import { ClaudeSubscriptionRow } from './model-settings'

const startManualProviderOAuth = vi.hoisted(() => vi.fn())
vi.mock('@/store/onboarding', async importOriginal => ({
  ...(await importOriginal<typeof OnboardingStore>()),
  startManualProviderOAuth
}))

function provider(overrides: Partial<ModelOptionProvider>): ModelOptionProvider {
  return { slug: 'claude-code', name: 'Claude Code', authenticated: true, models: ['sonnet'], ...overrides } as ModelOptionProvider
}

describe('ClaudeSubscriptionRow', () => {
  afterEach(() => {
    cleanup()
    startManualProviderOAuth.mockClear()
  })

  it('shows Connected when the claude-code provider is ready', () => {
    const rendered = render(<ClaudeSubscriptionRow providers={[provider({})]} />)
    expect(rendered.getByText('Connected')).toBeDefined()
    expect(rendered.queryByText('Connect')).toBeNull()
  })

  it('shows Connect when the provider is missing or unauthenticated', () => {
    const rendered = render(<ClaudeSubscriptionRow providers={[]} />)
    expect(rendered.getByText('Connect')).toBeDefined()
  })

  it('Connect starts the claude-code provider flow', () => {
    const rendered = render(<ClaudeSubscriptionRow providers={[]} />)
    fireEvent.click(rendered.getByText('Connect'))
    expect(startManualProviderOAuth).toHaveBeenCalledWith('claude-code')
  })
})
