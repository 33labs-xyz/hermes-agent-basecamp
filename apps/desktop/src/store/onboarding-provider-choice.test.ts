import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  $desktopOnboarding,
  type DesktopOnboardingState,
  dismissFirstRunOnboarding,
  startManualApiKey,
  startManualOnboarding,
  startManualProviderOAuth
} from './onboarding'

// A fully-populated baseline so each test starts from a known state without
// depending on INITIAL (which reads localStorage). initialApiKeyEnv defaults to
// null: no API-key form has been requested yet.
const BASE: DesktopOnboardingState = {
  configured: false,
  flow: { status: 'idle' },
  mode: 'openrouter',
  providers: null,
  reason: null,
  requested: false,
  firstRunSkipped: false,
  manual: false,
  localEndpoint: false,
  initialApiKeyEnv: null
}

function reset() {
  try {
    window.localStorage.clear()
  } catch {
    // jsdom localStorage should always be present; ignore if not.
  }

  $desktopOnboarding.set({ ...BASE })
}

beforeEach(reset)
afterEach(reset)

describe('startManualApiKey', () => {
  it('records which API-key env the form should prefill', () => {
    startManualApiKey('OPENROUTER_API_KEY')

    const state = $desktopOnboarding.get()

    expect(state.initialApiKeyEnv).toBe('OPENROUTER_API_KEY')
    expect(state.manual).toBe(true)
    expect(state.mode).toBe('apikey')
    expect(state.requested).toBe(true)
    // Never a local/custom endpoint: this path is a plain provider API key.
    expect(state.localEndpoint).toBe(false)
  })
})

describe('initialApiKeyEnv is cleared when leaving the API-key form', () => {
  it('startManualOnboarding clears it', () => {
    startManualApiKey('OPENROUTER_API_KEY')
    startManualOnboarding()

    expect($desktopOnboarding.get().initialApiKeyEnv).toBeNull()
  })

  it("startManualProviderOAuth('claude-code') clears it", () => {
    startManualApiKey('OPENROUTER_API_KEY')
    startManualProviderOAuth('claude-code')

    expect($desktopOnboarding.get().initialApiKeyEnv).toBeNull()
  })

  it('dismissFirstRunOnboarding clears it', () => {
    startManualApiKey('OPENROUTER_API_KEY')
    dismissFirstRunOnboarding()

    expect($desktopOnboarding.get().initialApiKeyEnv).toBeNull()
  })
})
