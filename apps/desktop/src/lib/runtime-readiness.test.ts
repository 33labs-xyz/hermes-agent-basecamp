import { describe, expect, it } from 'vitest'

import { interpretRuntimeReadiness, SAVED_CREDENTIALS_UNUSABLE_REASON } from './runtime-readiness'

describe('interpretRuntimeReadiness', () => {
  it('prefers runtime_check when both signals exist', () => {
    const result = interpretRuntimeReadiness({
      setup: { provider_configured: false },
      setupError: null,
      runtime: { ok: true },
      runtimeError: null
    })

    expect(result).toEqual({
      checksDisagree: true,
      ready: true,
      reason: null,
      source: 'runtime_check'
    })
  })

  it('surfaces runtime mismatch details when runtime_check fails', () => {
    const result = interpretRuntimeReadiness({
      setup: { provider_configured: true },
      setupError: null,
      runtime: { error: 'Selected runtime is not available.', ok: false },
      runtimeError: null
    })

    expect(result.ready).toBe(false)
    expect(result.source).toBe('runtime_check')
    expect(result.checksDisagree).toBe(true)
    expect(result.reason).toContain('Selected runtime is not available.')
    expect(result.reason).toContain('Saved credentials were found')
    // Internal RPC names must never leak into user-facing copy.
    expect(result.reason).not.toContain('setup.status')
  })

  it('replaces backend provider-setup jargon with human copy on a credential mismatch', () => {
    const result = interpretRuntimeReadiness({
      setup: { provider_configured: true },
      setupError: null,
      runtime: {
        error:
          "No inference provider configured. Run 'hermes model' to choose a provider and model, or set an API key (OPENROUTER_API_KEY, OPENAI_API_KEY, etc.) in ~/.hermes/.env.",
        ok: false
      },
      runtimeError: null
    })

    expect(result.ready).toBe(false)
    expect(result.checksDisagree).toBe(true)
    expect(result.reason).toBe(SAVED_CREDENTIALS_UNUSABLE_REASON)
    expect(result.reason).not.toContain('hermes model')
    expect(result.reason).not.toContain('~/.hermes')
  })

  it('falls back to the default reason when a provider-setup error carries no mismatch', () => {
    const result = interpretRuntimeReadiness(
      {
        setup: { provider_configured: false },
        setupError: null,
        runtime: { error: 'No inference provider configured. Run `hermes model` to choose one.', ok: false },
        runtimeError: null
      },
      { defaultReason: 'Connect a provider to start chatting.' }
    )

    expect(result.ready).toBe(false)
    expect(result.checksDisagree).toBe(false)
    expect(result.reason).toBe('Connect a provider to start chatting.')
  })

  it('uses the human mismatch copy when the runtime fails without any error text', () => {
    const result = interpretRuntimeReadiness({
      setup: { provider_configured: true },
      setupError: null,
      runtime: { ok: false },
      runtimeError: null
    })

    expect(result.ready).toBe(false)
    expect(result.checksDisagree).toBe(true)
    expect(result.reason).toBe(SAVED_CREDENTIALS_UNUSABLE_REASON)
  })

  it('falls back to setup.status when runtime_check has no boolean result', () => {
    const result = interpretRuntimeReadiness({
      setup: { provider_configured: true },
      setupError: null,
      runtime: null,
      runtimeError: 'runtime check RPC unavailable'
    })

    expect(result).toEqual({
      checksDisagree: false,
      ready: true,
      reason: null,
      source: 'setup_status'
    })
  })

  it('uses explicit fallback when both checks are missing', () => {
    const result = interpretRuntimeReadiness({
      setup: null,
      setupError: 'setup.status timeout',
      runtime: null,
      runtimeError: 'setup.runtime_check timeout'
    })

    expect(result.ready).toBe(false)
    expect(result.source).toBe('fallback')
    expect(result.reason).toBe('setup.runtime_check timeout')
  })
})
