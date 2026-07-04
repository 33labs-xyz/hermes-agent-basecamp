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

// True only when the user SAVED a credential for this provider inside Basecamp.
//
// The signal is /api/env `is_set`, which the backend derives purely from the
// on-disk ~/.hermes/.env; it does NOT merge os.environ. So ambient creds the
// backend harvests to authenticate a provider (the gh CLI keyring -> Copilot,
// an ANTHROPIC_* env -> Anthropic) read is_set:false and are correctly
// excluded, while a key the user pasted in Settings -> Providers reads
// is_set:true.
//
// KNOWN LIMIT: a provider set up purely via in-app OAuth writes to auth.json /
// the credential pool, not to .env, so this predicate would miss it. No such
// provider ships today (Claude-subscription OAuth was removed), so there is no
// regression; extend this predicate if one is added.
export function isProviderSetUpInApp(
  slug: string,
  env: null | Record<string, EnvVarInfo> | undefined
): boolean {
  return !!env && providerEnvKeys(slug).some(key => env[key]?.is_set === true)
}
