import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  $autoUpdate,
  $autoUpdateDismissed,
  $updateReady,
  dismissAutoUpdate,
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
    $autoUpdateDismissed.set(false)
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

  it('hides after dismiss for the same version', () => {
    const bridge = mockBridge()
    const stop = startAutoUpdateListener()
    bridge.emit({ stage: 'downloaded', version: '0.17.14' })
    dismissAutoUpdate()
    expect($updateReady.get()).toBe(false)
    bridge.emit({ stage: 'downloaded', version: '0.17.14' })
    expect($updateReady.get()).toBe(false)
    stop()
  })

  it('returns when a newer version downloads', () => {
    const bridge = mockBridge()
    const stop = startAutoUpdateListener()
    bridge.emit({ stage: 'downloaded', version: '0.17.14' })
    dismissAutoUpdate()
    bridge.emit({ stage: 'downloaded', version: '0.17.15' })
    expect($updateReady.get()).toBe(true)
    stop()
  })

  it('relaunchForUpdate invokes the bridge quitAndInstall', async () => {
    const bridge = mockBridge()
    await relaunchForUpdate()
    expect(bridge.quitAndInstall).toHaveBeenCalledOnce()
  })
})
