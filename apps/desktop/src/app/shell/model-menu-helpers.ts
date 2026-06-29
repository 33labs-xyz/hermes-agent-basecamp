import type { ModelOptionProvider } from '@/types/hermes'

// True when at least one provider exposes models — i.e. has usable credentials.
// The composer model menu only lists providers with models (groupModels drops
// empty-model providers), so when this is false there is nothing to pick: the
// empty state should offer to connect a provider rather than show a dead
// "No models found" row. Mirrors the dialog picker's
// `providers.filter(p => p.models.length > 0)` gate.
export function hasAuthenticatedModels(providers: ModelOptionProvider[] | undefined): boolean {
  return (providers ?? []).some(provider => (provider.models?.length ?? 0) > 0)
}
