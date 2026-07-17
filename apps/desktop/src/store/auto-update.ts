import { atom, computed } from 'nanostores'

import type { DesktopAutoUpdatePayload } from '@/global'

export const $autoUpdate = atom<DesktopAutoUpdatePayload>({ stage: 'none' })
// Latches the last 'downloaded' payload and never clears on a later 'checking'
// re-emit. electron-updater re-emits 'checking-for-update' then 'update-downloaded'
// from cache on every re-check (30-minute timer, window focus), so keying
// visibility on the live $autoUpdate.stage makes an already-visible pill unmount
// and remount on every re-check. Keying on this latch instead keeps the pill
// calm and persistent across re-check churn.
export const $downloadedUpdate = atom<DesktopAutoUpdatePayload | null>(null)
// When the last check reached a verdict. Packaged builds never run the git
// update flow, so the About panel has no other source for "last checked".
export const $autoUpdateCheckedAt = atom<number | null>(null)

// A downloaded update stays announced until it is installed. There is no
// dismiss on purpose: the pill used to have one, and because the dismissal
// only cleared for a NEWER version, ignoring the prompt once hid it for the
// rest of the run with no way to bring it back.
export const $updateReady = computed([$downloadedUpdate], downloaded => downloaded !== null)

// Stages that mean a check has finished and reported an answer.
const SETTLED_STAGES: ReadonlySet<DesktopAutoUpdatePayload['stage']> = new Set([
  'none',
  'downloaded',
  'error'
])

let active = false
let unsubscribe: (() => void) | null = null

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

    if (payload.stage === 'downloaded') {
      $downloadedUpdate.set(payload)
    }

    if (SETTLED_STAGES.has(payload.stage)) {
      $autoUpdateCheckedAt.set(Date.now())
    }
  })
  return stop
}

export async function relaunchForUpdate(): Promise<void> {
  await window.hermesDesktop?.quitAndInstall?.()
}
