import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  $desktopOnboarding,
  type DesktopOnboardingState,
  type OnboardingContext,
  peekPendingProviderOAuth
} from '@/store/onboarding'
import type { OAuthProvider } from '@/types/hermes'

import { Picker, providerTitle } from './desktop-onboarding-overlay'

function provider(id: string, name = id): OAuthProvider {
  return {
    cli_command: `hermes login ${id}`,
    docs_url: `https://example.com/${id}`,
    flow: 'pkce',
    id,
    name,
    status: { logged_in: false }
  }
}

function setProviders(providers: OAuthProvider[]) {
  $desktopOnboarding.set({
    configured: false,
    flow: { status: 'idle' },
    mode: 'oauth',
    providers,
    reason: null,
    requested: false,
    firstRunSkipped: false,
    manual: false,
    localEndpoint: false,
    initialApiKeyEnv: null
  } satisfies DesktopOnboardingState)
}

const ctx: OnboardingContext = { requestGateway: async () => undefined as never }

afterEach(() => {
  cleanup()

  try {
    window.localStorage.clear()
  } catch {
    // jsdom localStorage should always be present; ignore if not.
  }

  $desktopOnboarding.set({
    configured: null,
    flow: { status: 'idle' },
    mode: 'oauth',
    providers: null,
    reason: null,
    requested: false,
    firstRunSkipped: false,
    manual: false,
    localEndpoint: false,
    initialApiKeyEnv: null
  })
})

describe('onboarding Picker', () => {
  it('features OpenRouter at the top and hides sign-in providers behind a disclosure', () => {
    setProviders([provider('anthropic', 'Anthropic Claude'), provider('nous', 'Nous Portal')])
    render(<Picker ctx={ctx} />)

    // OpenRouter leads with the Recommended badge; the OAuth providers stay
    // hidden until the disclosure opens. Nous is no longer singled out.
    expect(screen.getByText('OpenRouter')).toBeTruthy()
    expect(screen.getByText('Recommended')).toBeTruthy()
    expect(screen.queryByText('Nous Portal')).toBeNull()
    expect(screen.queryByText('Anthropic API Key')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Other providers' }))

    // Expanded: every sign-in provider is a normal row, Nous included.
    expect(screen.getByText('Nous Portal')).toBeTruthy()
    expect(screen.getByText('Anthropic API Key')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeTruthy()
  })

  it('opens the API-key form when the featured OpenRouter card is picked', () => {
    setProviders([provider('anthropic', 'Anthropic Claude'), provider('openai-codex', 'OpenAI Codex / ChatGPT')])
    render(<Picker ctx={ctx} />)

    // OpenRouter is featured no matter which OAuth providers exist; the sign-in
    // options collapse behind the disclosure.
    expect(screen.getByText('OpenRouter')).toBeTruthy()
    expect(screen.queryByText('Anthropic API Key')).toBeNull()
    expect(screen.queryByText('OpenAI OAuth (ChatGPT)')).toBeNull()

    fireEvent.click(screen.getByText('OpenRouter'))

    expect($desktopOnboarding.get().mode).toBe('apikey')
  })

  it('never lists the Claude subscription (its OAuth flow is broken)', () => {
    setProviders([provider('claude-code', 'Claude Code'), provider('nous', 'Nous Portal')])
    render(<Picker ctx={ctx} />)

    fireEvent.click(screen.getByRole('button', { name: 'Other providers' }))

    expect(screen.getByText('Nous Portal')).toBeTruthy()
    expect(screen.queryByText('Claude subscription')).toBeNull()
  })

  it('offers "choose later" on first run and persists the skip', () => {
    setProviders([provider('nous', 'Nous Portal')])
    render(<Picker ctx={ctx} />)

    const skip = screen.getByRole('button', { name: "I'll choose a provider later" })

    fireEvent.click(skip)

    expect($desktopOnboarding.get().firstRunSkipped).toBe(true)
    expect(window.localStorage.getItem('hermes-onboarding-skipped-v1')).toBe('1')
  })

  it('hides "choose later" in manual (add-provider) mode', () => {
    setProviders([provider('nous', 'Nous Portal')])
    $desktopOnboarding.set({ ...$desktopOnboarding.get(), manual: true })
    render(<Picker ctx={ctx} />)

    expect(screen.queryByRole('button', { name: "I'll choose a provider later" })).toBeNull()
  })
})

describe('onboarding Picker — OpenRouter-first run', () => {
  it('first run shows the two-hero chooser, then OpenRouter on demand', () => {
    setProviders([provider('nous', 'Nous Portal')])
    $desktopOnboarding.set({ ...$desktopOnboarding.get(), mode: 'openrouter' })
    render(<Picker ctx={ctx} />)

    // Chooser lands first: two equal hero cards, not the key form or grid.
    expect(screen.getByText('Use OpenRouter')).toBeTruthy()
    expect(screen.getByText('Nous Portal')).toBeTruthy()
    // Claude subscription is not a hero card; it stays behind "Other provider".
    expect(screen.queryByText('Claude subscription')).toBeNull()
    // No card is branded "recommended" so startup pushes no single provider.
    expect(screen.queryByText('Recommended')).toBeNull()

    // Picking OpenRouter swaps in the streamlined key form plus the defer link.
    fireEvent.click(screen.getByText('Use OpenRouter'))
    expect(screen.getByText('OpenRouter')).toBeTruthy()
    expect(screen.getByRole('button', { name: "I'll choose a provider later" })).toBeTruthy()
  })

  it('the Nous Portal card starts the nous provider flow', () => {
    setProviders([provider('nous', 'Nous Portal')])
    $desktopOnboarding.set({ ...$desktopOnboarding.get(), mode: 'openrouter' })
    render(<Picker ctx={ctx} />)

    fireEvent.click(screen.getByText('Nous Portal'))

    const state = $desktopOnboarding.get()
    expect(state.manual).toBe(true)
    expect(state.requested).toBe(true)
    expect(peekPendingProviderOAuth()).toBe('nous')
  })
})

describe('providerTitle', () => {
  it('labels the claude-code provider "Claude subscription"', () => {
    expect(providerTitle(provider('claude-code', 'Claude Code'))).toBe('Claude subscription')
  })

  it('uses no em dash or en dash in the claude-code label', () => {
    expect(providerTitle(provider('claude-code', 'Claude Code'))).not.toMatch(/[–—]/)
  })
})
