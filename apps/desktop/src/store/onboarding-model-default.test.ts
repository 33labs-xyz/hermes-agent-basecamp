import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $currentModel, $currentProvider } from './session'

import {
  $desktopOnboarding,
  confirmOnboardingModel,
  type DesktopOnboardingState,
  type OnboardingContext,
  resolveOnboardingDefaultModel
} from './onboarding'

// Baseline state so tests don't depend on INITIAL (which reads localStorage).
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
  $currentModel.set('')
  $currentProvider.set('')
}

beforeEach(reset)
afterEach(reset)

// Regression: the hosted model catalog served an id the route cannot run
// (anthropic/claude-fable-5) and the confirm card blindly trusted the
// backend recommendation - onboarding showed "fable" while chat resolved
// to a different model. Recommendations only win when the provider's own
// options list contains them; Nous Portal is the one deliberate exception
// (its tier-aware free recommendation may not be in the curated list).
describe('resolveOnboardingDefaultModel', () => {
  const MODELS = ['anthropic/claude-opus-4.8', 'openai/gpt-5.5']

  it('falls back to the first curated model without a recommendation', () => {
    expect(resolveOnboardingDefaultModel(MODELS, null, 'openrouter')).toBe('anthropic/claude-opus-4.8')
    expect(resolveOnboardingDefaultModel(MODELS, undefined, 'openrouter')).toBe('anthropic/claude-opus-4.8')
  })

  it('uses the recommendation when the options list contains it', () => {
    expect(resolveOnboardingDefaultModel(MODELS, 'openai/gpt-5.5', 'openrouter')).toBe('openai/gpt-5.5')
  })

  it('rejects a recommendation missing from the options list', () => {
    expect(resolveOnboardingDefaultModel(MODELS, 'anthropic/claude-fable-5', 'openrouter')).toBe(
      'anthropic/claude-opus-4.8'
    )
  })

  it('trusts an unlisted recommendation only for the Nous provider', () => {
    expect(resolveOnboardingDefaultModel(MODELS, 'hermes-4.5-free', 'nous')).toBe('hermes-4.5-free')
    expect(resolveOnboardingDefaultModel(MODELS, 'hermes-4.5-free', 'Nous')).toBe('hermes-4.5-free')
  })
})

// Regression: onboarding persisted the confirmed model to backend config but
// never told the composer stores, so the chat model pill kept showing
// whatever the last session.info reported ("sonnet") instead of the model
// the user just confirmed.
describe('confirmOnboardingModel seeds the composer model stores', () => {
  const ctx = () => ({ onCompleted: vi.fn() }) as unknown as OnboardingContext

  it('copies the confirmed model + provider into the session atoms', () => {
    $desktopOnboarding.set({
      ...BASE,
      flow: {
        status: 'confirming_model',
        providerSlug: 'openrouter',
        currentModel: 'anthropic/claude-opus-4.8',
        label: 'OpenRouter',
        saving: false
      }
    })

    const context = ctx()
    confirmOnboardingModel(context)

    expect($currentModel.get()).toBe('anthropic/claude-opus-4.8')
    expect($currentProvider.get()).toBe('openrouter')
    expect($desktopOnboarding.get().configured).toBe(true)
  })

  it('does nothing outside the confirming_model step', () => {
    $currentModel.set('keep-model')
    $currentProvider.set('keep-provider')

    confirmOnboardingModel(ctx())

    expect($currentModel.get()).toBe('keep-model')
    expect($currentProvider.get()).toBe('keep-provider')
    expect($desktopOnboarding.get().configured).toBe(false)
  })
})
