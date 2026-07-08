import { atom } from 'nanostores'

import {
  connectStaffToolkit,
  fireStaffAgent,
  getStaffCatalog,
  getStaffState,
  hireStaffAgent,
  scheduleStaffAgent,
  setStaffLicense,
  type StaffCatalogEntry,
  type StaffConnectResult,
  type StaffState,
  unscheduleStaffAgent
} from '@/hermes'

// Staff: a marketplace of hireable background agents, each backed by a chat
// group and (once scheduled) a cron job. The catalog (what's available) and
// state (the user's roster + entitlement + connected toolkits) load once per
// session and refresh after each mutation.
export const $staffCatalog = atom<StaffCatalogEntry[]>([])
export const $staffState = atom<StaffState | null>(null)
export const $staffCatalogLoading = atom(false)
export const $staffStateLoading = atom(false)
// Per-agent-key busy flags so a single card's button disables during its own
// mutation without freezing the rest of the roster/directory.
export const $staffBusyKeys = atom<ReadonlySet<string>>(new Set())

let loadStarted = false

function setBusy(key: string, busy: boolean): void {
  const next = new Set($staffBusyKeys.get())

  if (busy) {
    next.add(key)
  } else {
    next.delete(key)
  }

  $staffBusyKeys.set(next)
}

export function isStaffKeyBusy(key: string): boolean {
  return $staffBusyKeys.get().has(key)
}

// A backend error's message embeds the HTTP status + JSON body (see
// electron/main.cjs fetchJson: `409: {"error_code":"slots_full"}`). Pull the
// code back out so callers can show a specific message instead of the raw
// transport error string.
export function staffErrorCode(err: unknown): string | null {
  const message = err instanceof Error ? err.message : String(err)
  const match = /"error_code"\s*:\s*"([a-zA-Z0-9_]+)"/.exec(message)

  return match?.[1] ?? null
}

export async function refreshStaffState(): Promise<void> {
  $staffStateLoading.set(true)

  try {
    $staffState.set(await getStaffState())
  } finally {
    $staffStateLoading.set(false)
  }
}

async function refreshStaffCatalog(): Promise<void> {
  $staffCatalogLoading.set(true)

  try {
    $staffCatalog.set(await getStaffCatalog())
  } finally {
    $staffCatalogLoading.set(false)
  }
}

// Idempotent one-shot load, mirroring ensureStudioKeyLoaded: every StaffView
// mount can call this safely — only the first call fetches.
export function ensureStaffLoaded(): void {
  if (loadStarted) {return}
  loadStarted = true

  void Promise.all([refreshStaffCatalog(), refreshStaffState()])
}

export async function hireAgent(key: string): Promise<void> {
  setBusy(key, true)

  try {
    await hireStaffAgent(key)
    await refreshStaffState()
  } finally {
    setBusy(key, false)
  }
}

export async function fireAgent(key: string): Promise<void> {
  setBusy(key, true)

  const previous = $staffState.get()

  // Optimistic removal: firing keeps the chat group + history server-side, so
  // there's nothing to preserve locally beyond rolling back the roster row if
  // the request fails.
  if (previous) {
    $staffState.set({ ...previous, roster: previous.roster.filter(row => row.key !== key) })
  }

  try {
    await fireStaffAgent(key)
    await refreshStaffState()
  } catch (err) {
    if (previous) {
      $staffState.set(previous)
    }

    throw err
  } finally {
    setBusy(key, false)
  }
}

export async function scheduleAgent(key: string, time?: string): Promise<void> {
  setBusy(key, true)

  try {
    await scheduleStaffAgent(key, time)
    await refreshStaffState()
  } finally {
    setBusy(key, false)
  }
}

export async function unscheduleAgent(key: string): Promise<void> {
  setBusy(key, true)

  try {
    await unscheduleStaffAgent(key)
    await refreshStaffState()
  } finally {
    setBusy(key, false)
  }
}

export async function saveLicense(key: string): Promise<void> {
  const result = await setStaffLicense(key)
  const current = $staffState.get()

  // Merge in place: an empty key clears back to free, a valid key upgrades to
  // pro. Roster/connections are unaffected by this endpoint, so no full
  // refetch is needed — just splice in the new entitlement.
  if (current) {
    $staffState.set({ ...current, entitlement: result })
  } else {
    void refreshStaffState()
  }
}

export function connectToolkit(slug: string): Promise<StaffConnectResult> {
  return connectStaffToolkit(slug)
}

// Test-only: reset module state between cases.
export function resetStaffForTests(): void {
  loadStarted = false
  $staffCatalog.set([])
  $staffState.set(null)
  $staffCatalogLoading.set(false)
  $staffStateLoading.set(false)
  $staffBusyKeys.set(new Set())
}
