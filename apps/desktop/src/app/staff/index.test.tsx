import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StaffState } from '@/hermes'
import { resetStaffForTests } from '@/store/staff'

const getStaffState = vi.fn()
const getStaffCatalog = vi.fn()
const navigateSpy = vi.fn()

// Partial mock: keep the real @/hermes (types, other endpoints) and override
// only the two reads ensureStaffLoaded() fires on mount, so the store's atoms
// populate with the composio_configured flag under test.
vi.mock('@/hermes', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hermes')>()
  return {
    ...actual,
    getStaffState: () => getStaffState(),
    getStaffCatalog: () => getStaffCatalog()
  }
})

vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateSpy }
})

// Notifications hit nanostores/timers we don't care about here.
vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))

function staffState(overrides: Partial<StaffState> = {}): StaffState {
  return {
    entitlement: { tier: 'free', slots: 1, schedules: false, purchase_url: null },
    roster: [],
    connections: [],
    composio_configured: false,
    ...overrides
  }
}

function renderStaff() {
  return import('./index').then(({ StaffView }) =>
    render(
      <MemoryRouter initialEntries={['/staff']}>
        <StaffView setStatusbarItemGroup={vi.fn()} />
      </MemoryRouter>
    )
  )
}

beforeEach(() => {
  resetStaffForTests()
  getStaffCatalog.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  resetStaffForTests()
  vi.clearAllMocks()
})

describe('StaffView Composio BYOK callout', () => {
  it('shows a connect-your-key callout when Composio is unconfigured', async () => {
    getStaffState.mockResolvedValue(staffState({ composio_configured: false }))

    await renderStaff()

    const btn = await screen.findByRole('button', { name: 'Add your Composio key' })
    fireEvent.click(btn)

    expect(navigateSpy).toHaveBeenCalledWith('/settings?tab=keys&kview=tools')
  })

  it('hides the callout once Composio is configured', async () => {
    getStaffState.mockResolvedValue(staffState({ composio_configured: true }))

    await renderStaff()

    // Wait for state to load (the Directory heading always renders), then assert
    // the callout button is absent.
    await screen.findByText('Directory')
    expect(screen.queryByRole('button', { name: 'Add your Composio key' })).toBeNull()
  })
})
