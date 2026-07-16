import { atom, computed } from 'nanostores'

import type { DesktopAutoUpdatePayload } from '@/global'

export const $autoUpdate = atom<DesktopAutoUpdatePayload>({ stage: 'none' })
export const $autoUpdateDismissed = atom<boolean>(false)
// Latches the last 'downloaded' payload and never clears on a later 'checking'
// re-emit. electron-updater re-emits 'checking-for-update' then 'update-downloaded'
// from cache on every re-check (30-minute timer, window focus), so keying
// visibility on the live $autoUpdate.stage makes an already-visible pill unmount
// and remount on every re-check. Keying on this latch instead keeps the pill
// calm and persistent across re-check churn.
export const $downloadedUpdate = atom<DesktopAutoUpdatePayload | null>(null)

export const $updateReady = computed(
  [$downloadedUpdate, $autoUpdateDismissed],
  (downloaded, dismissed) => downloaded !== null && !dismissed
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
    if (payload.stage === 'downloaded') {
      $downloadedUpdate.set(payload)
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
