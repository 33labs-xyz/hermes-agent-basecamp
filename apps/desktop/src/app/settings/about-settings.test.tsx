import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DesktopVersionInfo } from '@/global'
import { $autoUpdate, $autoUpdateCheckedAt, $downloadedUpdate } from '@/store/auto-update'
import { $desktopVersion, $updateStatus } from '@/store/updates'

import { AboutSettings } from './about-settings'

const PACKAGED: DesktopVersionInfo = {
  appVersion: '0.17.20',
  electronVersion: '32.0.0',
  nodeVersion: '20.0.0',
  platform: 'darwin',
  hermesRoot: '/tmp/hermes',
  isPackaged: true
}

describe('AboutSettings (packaged build)', () => {
  beforeEach(() => {
    $desktopVersion.set(PACKAGED)
    $updateStatus.set(null)
    $autoUpdate.set({ stage: 'none' })
    $autoUpdateCheckedAt.set(null)
    $downloadedUpdate.set(null)
    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
  })

  afterEach(() => {
    cleanup()
    $desktopVersion.set(null)
    $updateStatus.set(null)
  })

  // Packaged builds update via electron-updater, whose signals live in the
  // auto-update store. About used to read only the git store, so every
  // packaged build sat on "Tap Check now" forever no matter what the updater
  // reported - the panel could never say an update was waiting.
  it('reports a downloaded update and offers the relaunch action', () => {
    $downloadedUpdate.set({ stage: 'downloaded', version: '0.17.21' })
    render(<AboutSettings />)

    expect(screen.getByText(/version 0\.17\.21 ready/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /relaunch to update/i })).toBeDefined()
  })

  it('reports download progress while the update transfers', () => {
    $autoUpdate.set({ stage: 'downloading', percent: 42.4 })
    render(<AboutSettings />)

    expect(screen.getByText(/downloading update: 42%/i)).toBeDefined()
  })

  it('confirms up to date once a check comes back empty', () => {
    $autoUpdate.set({ stage: 'none' })
    $autoUpdateCheckedAt.set(Date.now())
    render(<AboutSettings />)

    expect(screen.getByText(/on the latest version/i)).toBeDefined()
    expect(screen.getByText(/last checked just now/i)).toBeDefined()
  })

  it('surfaces a failed check instead of staying silent', () => {
    $autoUpdate.set({ stage: 'error', message: 'net::ERR_CONNECTION_REFUSED' })
    $autoUpdateCheckedAt.set(Date.now())
    render(<AboutSettings />)

    expect(screen.getByText(/couldn't reach the update server/i)).toBeDefined()
  })
})
