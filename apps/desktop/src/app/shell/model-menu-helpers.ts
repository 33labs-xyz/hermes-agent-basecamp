import { isProviderSetUpInApp } from '@/lib/provider-credentials'
import type { EnvVarInfo, ModelOptionProvider } from '@/types/hermes'

// True when at least one CONNECTED provider exposes models. A not-connected
// provider (`authenticated === false`) can still carry a model catalog —
// ambient credentials the backend refused to verify — but those models 401,
// so they must not count. When this is false there is nothing to pick: the
// empty state should offer to connect a provider rather than show a dead
// "No models found" row.
//
// With a loaded `configuredEnv`, the bar is raised to match the picker: a
// provider only counts if the user set it up IN Basecamp (its key is_set in
// ~/.hermes/.env), so a machine whose only "authenticated" providers were
// harvested from ambient creds still shows the Connect CTA. A null/omitted env
// is fail-open — fall back to the authenticated-only test.
export function hasAuthenticatedModels(
  providers: ModelOptionProvider[] | undefined,
  configuredEnv?: null | Record<string, EnvVarInfo>
): boolean {
  return (providers ?? []).some(
    provider =>
      provider.authenticated !== false &&
      (provider.models?.length ?? 0) > 0 &&
      (!configuredEnv || isProviderSetUpInApp(provider.slug, configuredEnv))
  )
}
