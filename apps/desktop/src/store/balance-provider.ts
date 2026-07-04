import { atom } from 'nanostores'

// Which provider's balance the titlebar chip shows. Persisted so the choice
// survives restarts. null means "no explicit pick" and the chip falls back to
// the default provider (OpenRouter-first). Studio pins Muapi regardless.
const STORAGE_KEY = 'basecamp.balanceProvider'

function readStored(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)

    return value && value.trim() ? value : null
  } catch {
    return null
  }
}

export const $balanceProvider = atom<string | null>(readStored())

export function setBalanceProvider(slug: string | null): void {
  const trimmed = slug?.trim() ?? ''

  if (!trimmed) {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Best-effort; ignore storage failures (private mode, quota).
    }

    $balanceProvider.set(null)

    return
  }

  try {
    localStorage.setItem(STORAGE_KEY, trimmed)
  } catch {
    // Best-effort; ignore storage failures (private mode, quota).
  }

  $balanceProvider.set(trimmed)
}

// Test-only: clear both the atom and the persisted value between cases.
export function resetBalanceProviderForTests(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }

  $balanceProvider.set(null)
}
