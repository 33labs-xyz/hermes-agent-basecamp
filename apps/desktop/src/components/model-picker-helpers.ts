import { isProviderSetUpInApp } from '@/lib/provider-credentials'
import type { EnvVarInfo, ModelOptionProvider } from '@/types/hermes'

// The providers the full picker dialog lists as selectable. A provider needs a
// curated model catalog (switching to a not-yet-configured provider goes
// through the "Add provider" footer instead).
//
// With a loaded `configuredEnv`, the bar is raised to match the composer
// picker: only providers the user set up IN Basecamp (their key is_set in
// ~/.hermes/.env) are listed, so providers the backend authenticated from
// harvested ambient creds (gh CLI -> Copilot, ANTHROPIC_* -> Anthropic) drop
// out. A null env (still loading, or /api/env failed) is fail-open: fall back
// to the catalog-only filter so the user is never locked out of switching.
export function pickableProviders(
  providers: ModelOptionProvider[],
  configuredEnv: null | Record<string, EnvVarInfo>
): ModelOptionProvider[] {
  return providers.filter(
    provider => (provider.models ?? []).length > 0 && (!configuredEnv || isProviderSetUpInApp(provider.slug, configuredEnv))
  )
}
