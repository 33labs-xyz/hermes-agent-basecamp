import type { EnvVarInfo } from '@/types/hermes'

// Backend slug -> the env var(s) whose presence in the user's SAVED env means
// "the user set this provider up in Basecamp themselves". Only slugs whose env
// vars deviate from the ${SLUG}_API_KEY default live here; everything else
// derives via defaultEnvKey.
//
// KEEP IN SYNC with hermes_cli/auth.py `api_key_env_vars`. If the backend
// renames or adds a provider's env vars, mirror it here, or that provider will
// be wrongly hidden from (or shown in) the model picker.
export const ENV_KEY_OVERRIDES: Record<string, string[]> = {
  alibaba: ['DASHSCOPE_API_KEY'],
  'alibaba-coding-plan': ['ALIBABA_CODING_PLAN_API_KEY', 'DASHSCOPE_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
  arcee: ['ARCEEAI_API_KEY'],
  copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
  gemini: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  huggingface: ['HF_TOKEN'],
  'kimi-coding': ['KIMI_API_KEY', 'KIMI_CODING_API_KEY'],
  'kimi-coding-cn': ['KIMI_CN_API_KEY'],
  lmstudio: ['LM_API_KEY'],
  'ollama-cloud': ['OLLAMA_API_KEY'],
  'openai-api': ['OPENAI_API_KEY'],
  'tencent-tokenhub': ['TOKENHUB_API_KEY'],
  zai: ['GLM_API_KEY', 'ZAI_API_KEY', 'Z_AI_API_KEY']
}

// Best-effort default, mirroring the backend's own slug->env derivation
// (store/onboarding.ts, hermes_cli/auth.py): SLUG upcased, hyphens turned into
// underscores, suffixed with _API_KEY. Covers openrouter, xai, deepseek, nous,
// and the other regular providers.
export function defaultEnvKey(slug: string): string {
  return `${slug.toUpperCase().replace(/-/g, '_')}_API_KEY`
}

// The env var(s) that, once saved, mean the user configured this provider.
export function providerEnvKeys(slug: string): string[] {
  return ENV_KEY_OVERRIDES[slug] ?? [defaultEnvKey(slug)]
}

// Inverse of providerEnvKeys: given a saved env var name, return the backend
// slug the user configured. Override aliases (GOOGLE_API_KEY -> gemini) win;
// everything else strips the trailing _API_KEY and lowercases, mirroring
// defaultEnvKey in reverse.
export function envKeyToSlug(envKey: string): string {
  for (const [slug, keys] of Object.entries(ENV_KEY_OVERRIDES)) {
    if (keys.includes(envKey)) {
      return slug
    }
  }

  return envKey.replace(/_API_KEY$/, '').toLowerCase().replace(/_/g, '-')
}

// Providers the backend authenticates WITHOUT any user-saved .env key - their
// auth_type is not an API key (e.g. external_process = a local CLI the backend
// detects). The backend only returns these with authenticated:true when they
// are actually usable, and there is no .env key to check, so the app-side
// "did the user save a key" gate does not apply. Extend as more are added.
const NON_API_KEY_PROVIDERS = new Set<string>(['claude-cli'])

// True only when the user configured this provider inside Basecamp - either by
// saving its credential (/api/env is_set), or, for NON_API_KEY_PROVIDERS, by the
// backend having authenticated it from a non-key source (the model-options row
// only exists when it is usable).
//
// The is_set signal comes from ~/.hermes/.env only; it does NOT merge os.environ,
// so ambient creds the backend harvests to authenticate a provider (gh CLI
// keyring -> Copilot, an ANTHROPIC_* env -> Anthropic) read is_set:false and are
// correctly excluded, while a key pasted in Settings -> Providers reads is_set:true.
export function isProviderSetUpInApp(
  slug: string,
  env: null | Record<string, EnvVarInfo> | undefined
): boolean {
  if (NON_API_KEY_PROVIDERS.has(slug)) {
    return true
  }
  return !!env && providerEnvKeys(slug).some(key => env[key]?.is_set === true)
}
