import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  $autoUpdate,
  $autoUpdateCheckedAt,
  $downloadedUpdate,
  $updateReady,
  relaunchForUpdate,
  startAutoUpdateListener
} from './auto-update'

function mockBridge() {
  let handler: ((p: unknown) => void) | null = null
  const quitAndInstall = vi.fn(async () => {})
  ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = {
    onAutoUpdate: (cb: (p: unknown) => void) => {
      handler = cb
      return () => { handler = null }
    },
    quitAndInstall
  }
  return { emit: (p: unknown) => handler?.(p), quitAndInstall }
}

describe('auto-update store', () => {
  beforeEach(() => {
    $autoUpdate.set({ stage: 'none' })
    $autoUpdateCheckedAt.set(null)
    $downloadedUpdate.set(null)
    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
  })

  it('is a safe no-op when the desktop bridge is absent', () => {
    const stop = startAutoUpdateListener()
    expect(typeof stop).toBe('function')
    expect($updateReady.get()).toBe(false)
    stop()
  })

  it('marks the update ready when a downloaded payload arrives', () => {
    const bridge = mockBridge()
    const stop = startAutoUpdateListener()
    bridge.emit({ stage: 'downloaded', version: '0.17.14' })
    expect($updateReady.get()).toBe(true)
    stop()
  })

  // Regression: a dismissable pill plus a version-equality guard made an
  // ignored update unrecoverable. electron-updater re-emits the SAME version
  // from cache on every re-check, so the old guard swallowed the only event
  // that could have brought the prompt back. Readiness now depends on the
  // download alone, so a re-emit is always enough to keep the pill up.
  it('stays ready when the same version re-emits from cache', () => {
    const bridge = mockBridge()
    const stop = startAutoUpdateListener()
    bridge.emit({ stage: 'downloaded', version: '0.17.14' })
    bridge.emit({ stage: 'downloaded', version: '0.17.14' })
    expect($updateReady.get()).toBe(true)
    stop()
  })

  it('records when a check finishes so About can report it', () => {
    const bridge = mockBridge()
    const stop = startAutoUpdateListener()
    expect($autoUpdateCheckedAt.get()).toBeNull()
    bridge.emit({ stage: 'checking' })
    expect($autoUpdateCheckedAt.get()).toBeNull()
    bridge.emit({ stage: 'none' })
    expect($autoUpdateCheckedAt.get()).toBeTypeOf('number')
    stop()
  })

  it('relaunchForUpdate invokes the bridge quitAndInstall', async () => {
    const bridge = mockBridge()
    await relaunchForUpdate()
    expect(bridge.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('stays ready through a re-check churn (checking-for-update re-emitted after downloaded)', () => {
    const bridge = mockBridge()
    const stop = startAutoUpdateListener()
    bridge.emit({ stage: 'downloaded', version: '0.18.0' })
    expect($updateReady.get()).toBe(true)
    bridge.emit({ stage: 'checking' })
    expect($updateReady.get()).toBe(true)
    expect($downloadedUpdate.get()?.version).toBe('0.18.0')
    stop()
  })
})
