import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $downloadedUpdate } from '@/store/auto-update'

import { UpdateReadyPill } from './update-ready-pill'

describe('UpdateReadyPill', () => {
  beforeEach(() => {
    $downloadedUpdate.set(null)
    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
  })

  afterEach(cleanup)

  it('renders nothing when no update is downloaded', () => {
    render(<UpdateReadyPill />)
    expect(screen.queryByText(/relaunch to update/i)).toBeNull()
  })

  it('shows the label and version when an update is ready', () => {
    $downloadedUpdate.set({ stage: 'downloaded', version: '0.17.14' })
    render(<UpdateReadyPill />)
    expect(screen.getByText(/relaunch to update/i)).toBeDefined()
    expect(screen.getByText(/0\.17\.14/)).toBeDefined()
  })

  it('leads with a headline so the update prompt is unmissable', () => {
    // The card wants a plain-language headline above the version line - the old
    // skinny pill buried the prompt in a single inline label. The headline and
    // the relaunch action are distinct nodes so the CTA stays a real button.
    $downloadedUpdate.set({ stage: 'downloaded', version: '0.17.14' })
    render(<UpdateReadyPill />)
    expect(screen.getByText(/update available/i)).toBeDefined()
  })

  it('clicking the pill relaunches', () => {
    const quitAndInstall = vi.fn(async () => {})

    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { quitAndInstall }
    $downloadedUpdate.set({ stage: 'downloaded', version: '0.17.14' })
    render(<UpdateReadyPill />)
    fireEvent.click(screen.getByRole('button', { name: /relaunch to update/i }))
    expect(quitAndInstall).toHaveBeenCalledOnce()
  })

  // Relaunch is the only way out of the card. A dismiss control let testers
  // hide a downloaded update with no way to bring it back, so the card stays
  // put until they act on it.
  it('offers no way to dismiss the card', () => {
    $downloadedUpdate.set({ stage: 'downloaded', version: '0.17.14' })
    render(<UpdateReadyPill />)
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})
