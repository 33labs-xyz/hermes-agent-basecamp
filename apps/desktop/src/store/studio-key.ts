import { atom } from 'nanostores'

// Muapi Studio API key, mirrored from the OS-encrypted store in the main
// process (studio:key:get/set). Shared by the Studio view and the titlebar
// profile so both react to the same connect/update actions.
// `null` = not loaded yet; '' = loaded, none stored; non-empty = ready.
export const $studioKey = atom<string | null>(null)

let loadStarted = false

// Idempotent one-shot load from the main process. Safe to call from every
// consumer mount; only the first call fetches.
export function ensureStudioKeyLoaded(): void {
  if (loadStarted) {return}
  loadStarted = true

  void (async () => {
    let stored = ''

    try {
      stored = (await window.hermesDesktop?.studio?.getKey()) ?? ''
    } catch {
      stored = ''
    }

    // A save that raced the initial read wins; don't clobber it.
    if ($studioKey.get() === null) {$studioKey.set(stored)}
  })()
}

// Persist a new key (OS-encrypted via safeStorage in the main process) and
// broadcast it to every consumer.
export function saveStudioKey(key: string): void {
  const trimmed = key.trim()

  if (!trimmed) {return}
  void window.hermesDesktop?.studio?.setKey(trimmed)
  $studioKey.set(trimmed)
}

// Test-only: reset module state between cases.
export function resetStudioKeyForTests(): void {
  loadStarted = false
  $studioKey.set(null)
}
