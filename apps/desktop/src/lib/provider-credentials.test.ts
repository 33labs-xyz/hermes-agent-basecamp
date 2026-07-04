import { describe, expect, it } from 'vitest'

import type { EnvVarInfo } from '@/types/hermes'

import { defaultEnvKey, isProviderSetUpInApp, providerEnvKeys } from './provider-credentials'

// Only `is_set` drives the predicate; the rest is EnvVarInfo boilerplate.
function envInfo(isSet: boolean): EnvVarInfo {
  return {
    advanced: false,
    category: '',
    description: '',
    is_password: true,
    is_set: isSet,
    redacted_value: null,
    tools: [],
    url: null
  }
}

function env(entries: Record<string, boolean>): Record<string, EnvVarInfo> {
  return Object.fromEntries(Object.entries(entries).map(([key, isSet]) => [key, envInfo(isSet)]))
}

describe('defaultEnvKey', () => {
  it('derives ${SLUG}_API_KEY, upcasing and turning hyphens into underscores', () => {
    expect(defaultEnvKey('openrouter')).toBe('OPENROUTER_API_KEY')
    expect(defaultEnvKey('xai')).toBe('XAI_API_KEY')
    expect(defaultEnvKey('minimax-cn')).toBe('MINIMAX_CN_API_KEY')
  })
})

describe('providerEnvKeys', () => {
  it('uses the derived key for regular slugs', () => {
    expect(providerEnvKeys('openrouter')).toEqual(['OPENROUTER_API_KEY'])
    expect(providerEnvKeys('deepseek')).toEqual(['DEEPSEEK_API_KEY'])
    expect(providerEnvKeys('nous')).toEqual(['NOUS_API_KEY'])
  })

  it('uses the override list for slugs whose backend env vars deviate', () => {
    // Mirrors hermes_cli/auth.py api_key_env_vars for the deviant slugs.
    expect(providerEnvKeys('gemini')).toEqual(['GOOGLE_API_KEY', 'GEMINI_API_KEY'])
    expect(providerEnvKeys('alibaba')).toEqual(['DASHSCOPE_API_KEY'])
    expect(providerEnvKeys('copilot')).toEqual(['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'])
    expect(providerEnvKeys('anthropic')).toEqual(['ANTHROPIC_API_KEY', 'ANTHROPIC_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'])
    expect(providerEnvKeys('huggingface')).toEqual(['HF_TOKEN'])
  })
})

describe('isProviderSetUpInApp', () => {
  it('is true when the derived key is saved in the app env', () => {
    expect(isProviderSetUpInApp('openrouter', env({ OPENROUTER_API_KEY: true }))).toBe(true)
  })

  it('is true when ANY override key is saved (alibaba via DASHSCOPE_API_KEY)', () => {
    expect(isProviderSetUpInApp('alibaba', env({ DASHSCOPE_API_KEY: true }))).toBe(true)
  })

  it('is false when the provider is authenticated only via harvested ambient creds', () => {
    // The decisive case. The backend authenticates copilot from the gh CLI
    // keyring and anthropic from an ambient ANTHROPIC_* env, but /api/env reads
    // is_set:false for those because the user never saved them IN Basecamp.
    const harvested = env({ GH_TOKEN: false, GITHUB_TOKEN: false, ANTHROPIC_API_KEY: false })
    expect(isProviderSetUpInApp('copilot', harvested)).toBe(false)
    expect(isProviderSetUpInApp('anthropic', harvested)).toBe(false)
  })

  it('is false when the provider key is absent from the env map entirely', () => {
    expect(isProviderSetUpInApp('xai', env({ OPENROUTER_API_KEY: true }))).toBe(false)
  })

  it('is false for a null or undefined env (nothing known yet)', () => {
    expect(isProviderSetUpInApp('openrouter', null)).toBe(false)
    expect(isProviderSetUpInApp('openrouter', undefined)).toBe(false)
  })
})
