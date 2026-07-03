import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { $studioKey, resetStudioKeyForTests } from '@/store/studio-key'

import { TitlebarProfile } from './titlebar-profile'

// Mock the balance hook so the test never touches the vendored muapi transport.
const balanceMock = vi.hoisted(() => ({ value: null as number | null }))

vi.mock('../studio/use-studio-balance', () => ({
  useStudioBalance: () => balanceMock.value,
  formatCredits: (balance: number) => balance.toLocaleString('en-US', { maximumFractionDigits: 2 })
}))

// Radix calls these on open; jsdom doesn't implement them.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

beforeEach(() => {
  resetStudioKeyForTests()
  balanceMock.value = null
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function openDropdown() {
  const trigger = screen.getByRole('button', { name: 'Profile' })

  // Radix dropdown triggers toggle on pointerdown (main button, no ctrl).
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })

  return trigger
}

describe('TitlebarProfile', () => {
  it('shows the add-key form when no key is stored', async () => {
    render(<TitlebarProfile />)
    openDropdown()

    expect(await screen.findByText('Add Muapi key')).toBeTruthy()
    expect(screen.getByPlaceholderText('Muapi API key')).toBeTruthy()
    expect(screen.queryByText('Update Muapi key')).toBeNull()
  })

  it('saves a key from the form and closes the menu', async () => {
    render(<TitlebarProfile />)
    openDropdown()

    fireEvent.change(await screen.findByPlaceholderText('Muapi API key'), { target: { value: '  sk-titlebar  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect($studioKey.get()).toBe('sk-titlebar')
    expect(screen.queryByPlaceholderText('Muapi API key')).toBeNull()
  })

  it('hides the form behind an update row once a key exists', async () => {
    $studioKey.set('sk-live')
    render(<TitlebarProfile />)
    openDropdown()

    expect(await screen.findByText('Update Muapi key')).toBeTruthy()
    expect(screen.queryByPlaceholderText('Muapi API key')).toBeNull()

    fireEvent.click(screen.getByText('Update Muapi key'))

    expect(screen.getByPlaceholderText('Muapi API key')).toBeTruthy()
  })

  it('shows the credit balance in the trigger and menu when available', async () => {
    $studioKey.set('sk-live')
    balanceMock.value = 1234.5
    render(<TitlebarProfile />)

    expect(screen.getByTestId('titlebar-credits').textContent).toBe('1,234.5')

    openDropdown()

    expect(await screen.findByText('credits remaining')).toBeTruthy()
  })

  it('shows no credits chip while the balance is unknown', () => {
    $studioKey.set('sk-live')
    render(<TitlebarProfile />)

    expect(screen.queryByTestId('titlebar-credits')).toBeNull()
  })
})
