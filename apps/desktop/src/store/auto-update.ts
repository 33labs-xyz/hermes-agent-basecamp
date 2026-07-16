import { atom, computed } from 'nanostores'

import type { DesktopAutoUpdatePayload } from '@/global'

export const $autoUpdate = atom<DesktopAutoUpdatePayload>({ stage: 'none' })
export const $autoUpdateDismissed = atom<boolean>(false)

export const $updateReady = computed(
  [$autoUpdate, $autoUpdateDismissed],
  (update, dismissed) => update.stage === 'downloaded' && !dismissed
)

let active = false
let unsubscribe: (() => void) | null = null
let lastShownVersion: string | undefined

function stop(): void {
  if (unsubscribe) unsubscribe()
  unsubscribe = null
  active = false
}

// Subscribe once to packaged-build auto-update events. Idempotent, and a safe
// no-op when the desktop bridge is unavailable (dev/source builds). Returns an
// unsubscribe fn.
export function startAutoUpdateListener(): () => void {
  if (active) return stop
  const onAutoUpdate = typeof window !== 'undefined' ? window.hermesDesktop?.onAutoUpdate : undefined
  if (!onAutoUpdate) return () => {}
  active = true
  unsubscribe = onAutoUpdate((payload: DesktopAutoUpdatePayload) => {
    $autoUpdate.set(payload)
    // A freshly downloaded NEWER version clears any prior session dismissal so the
    // pill returns; the same version re-emitting stays hidden once dismissed.
    if (payload.stage === 'downloaded' && payload.version !== lastShownVersion) {
      lastShownVersion = payload.version
      $autoUpdateDismissed.set(false)
    }
  })
  return stop
}

export function dismissAutoUpdate(): void {
  $autoUpdateDismissed.set(true)
}

export async function relaunchForUpdate(): Promise<void> {
  await window.hermesDesktop?.quitAndInstall?.()
}
