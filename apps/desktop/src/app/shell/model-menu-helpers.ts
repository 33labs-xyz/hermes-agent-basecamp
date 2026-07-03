import type { ModelOptionProvider } from '@/types/hermes'

// True when at least one CONNECTED provider exposes models. A not-connected
// provider (`authenticated === false`) can still carry a model catalog —
// ambient credentials the backend refused to verify — but those models 401,
// so they must not count. When this is false there is nothing to pick: the
// empty state should offer to connect a provider rather than show a dead
// "No models found" row.
export function hasAuthenticatedModels(providers: ModelOptionProvider[] | undefined): boolean {
  return (providers ?? []).some(provider => provider.authenticated !== false && (provider.models?.length ?? 0) > 0)
}
