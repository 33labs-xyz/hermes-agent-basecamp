import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $autoUpdate, $autoUpdateDismissed } from '@/store/auto-update'

import { UpdateReadyPill } from './update-ready-pill'

describe('UpdateReadyPill', () => {
  beforeEach(() => {
    $autoUpdate.set({ stage: 'none' })
    $autoUpdateDismissed.set(false)
    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
  })

  afterEach(cleanup)

  it('renders nothing when no update is downloaded', () => {
    render(<UpdateReadyPill />)
    expect(screen.queryByText(/relaunch to update/i)).toBeNull()
  })

  it('shows the label and version when an update is ready', () => {
    $autoUpdate.set({ stage: 'downloaded', version: '0.17.14' })
    render(<UpdateReadyPill />)
    expect(screen.getByText(/relaunch to update/i)).toBeDefined()
    expect(screen.getByText(/0\.17\.14/)).toBeDefined()
  })

  it('clicking the pill relaunches', () => {
    const quitAndInstall = vi.fn(async () => {})

    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { quitAndInstall }
    $autoUpdate.set({ stage: 'downloaded', version: '0.17.14' })
    render(<UpdateReadyPill />)
    fireEvent.click(screen.getByRole('button', { name: /relaunch to update/i }))
    expect(quitAndInstall).toHaveBeenCalledOnce()
  })

  it('clicking dismiss hides without relaunching', () => {
    const quitAndInstall = vi.fn(async () => {})

    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { quitAndInstall }
    $autoUpdate.set({ stage: 'downloaded', version: '0.17.14' })
    render(<UpdateReadyPill />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(screen.queryByText(/relaunch to update/i)).toBeNull()
  })
})
