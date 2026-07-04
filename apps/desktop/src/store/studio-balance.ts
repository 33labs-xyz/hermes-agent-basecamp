import { atom } from 'nanostores'

// Monotonic tick that bumps whenever a Studio generation spends credits. The
// titlebar profile balance subscribes to it as a refresh signal, so the single
// credit readout stays live after each generation without polling. Studio
// generation-complete handlers call bumpStudioBalance() once a job resolves.
export const $studioBalanceVersion = atom(0)

export function bumpStudioBalance(): void {
  $studioBalanceVersion.set($studioBalanceVersion.get() + 1)
}

// Test-only: reset module state between cases.
export function resetStudioBalanceForTests(): void {
  $studioBalanceVersion.set(0)
}
