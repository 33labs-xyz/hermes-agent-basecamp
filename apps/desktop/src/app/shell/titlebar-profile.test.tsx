import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { $balanceProvider, resetBalanceProviderForTests } from '@/store/balance-provider'

const rowsMock = vi.hoisted(() => ({
  value: [] as Array<{ slug: string; label: string; status: string; balance: number | null }>
}))
const routeMock = vi.hoisted(() => ({ view: 'chat' }))

vi.mock('./use-provider-balances', () => ({
  useProviderBalances: () => rowsMock.value
}))
vi.mock('./hooks/use-overlay-routing', () => ({
  useOverlayRouting: () => ({ currentView: routeMock.view })
}))
vi.mock('../studio/use-studio-balance', () => ({
  formatCredits: (balance: number) => balance.toLocaleString('en-US', { maximumFractionDigits: 2 }),
  useStudioBalance: () => null
}))
vi.mock('@/store/studio-key', () => ({
  ensureStudioKeyLoaded: vi.fn()
}))
vi.mock('@/lib/external-link', () => ({
  openExternalLink: vi.fn()
}))

import { openExternalLink } from '@/lib/external-link'

import { TitlebarProfile } from './titlebar-profile'

const OK_ROWS = [
  { slug: 'openrouter', label: 'OpenRouter', status: 'ok', balance: 12.5 },
  { slug: 'muapi', label: 'Muapi', status: 'ok', balance: 900 }
]

beforeAll(() => {
  // Radix DropdownMenu needs these jsdom shims to open under pointer events.
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

beforeEach(() => {
  resetBalanceProviderForTests()
  rowsMock.value = OK_ROWS
  routeMock.view = 'chat'
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function openDropdown() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Profile' }), { button: 0, ctrlKey: false })
}

describe('TitlebarProfile', () => {
  it('renders nothing when no provider exposes a number', () => {
    rowsMock.value = [
      { slug: 'openrouter', label: 'OpenRouter', status: 'unavailable', balance: null },
      { slug: 'muapi', label: 'Muapi', status: 'unavailable', balance: null }
    ]

    const { container } = render(<TitlebarProfile />)

    expect(screen.queryByRole('button', { name: 'Profile' })).toBeNull()
    expect(container.firstChild).toBeNull()
  })

  it('shows the OpenRouter-first balance by default', () => {
    render(<TitlebarProfile />)

    expect(screen.getByTestId('titlebar-credits').textContent).toBe('12.5')
  })

  it('pins the chip to Muapi on the Studio screen', () => {
    routeMock.view = 'studio'

    render(<TitlebarProfile />)

    expect(screen.getByTestId('titlebar-credits').textContent).toBe('900')
  })

  it('persists a picked provider and updates the chip', () => {
    render(<TitlebarProfile />)

    openDropdown()
    fireEvent.click(screen.getByText('Muapi'))

    expect($balanceProvider.get()).toBe('muapi')
    expect(screen.getByTestId('titlebar-credits').textContent).toBe('900')
  })

  it('does not render a Muapi key form', () => {
    render(<TitlebarProfile />)

    openDropdown()

    expect(screen.queryByPlaceholderText('Muapi API key')).toBeNull()
  })

  it('labels non-ok rows distinctly and disables them so the pick cannot change', () => {
    rowsMock.value = [
      { slug: 'openrouter', label: 'OpenRouter', status: 'ok', balance: 12.5 },
      { slug: 'gemini', label: 'Gemini', status: 'unavailable', balance: null },
      { slug: 'anthropic', label: 'Anthropic', status: 'unsupported', balance: null }
    ]

    render(<TitlebarProfile />)
    openDropdown()

    // unavailable -> "unavailable", unsupported -> "n/a" (distinct per spec).
    expect(screen.getByText('unavailable')).toBeTruthy()
    expect(screen.getByText('n/a')).toBeTruthy()

    const geminiRow = screen.getByText('Gemini').closest('[role="menuitem"]')
    const anthropicRow = screen.getByText('Anthropic').closest('[role="menuitem"]')
    expect(geminiRow?.getAttribute('aria-disabled')).toBe('true')
    expect(anthropicRow?.getAttribute('aria-disabled')).toBe('true')

    // Clicking a disabled row must not change the persisted pick.
    fireEvent.click(screen.getByText('Gemini'))
    expect($balanceProvider.get()).toBeNull()
  })

  it('opens the OpenRouter top-up page from the dropdown', () => {
    render(<TitlebarProfile />)

    openDropdown()
    fireEvent.click(screen.getByText('Top up OpenRouter'))

    expect(vi.mocked(openExternalLink)).toHaveBeenCalledWith('https://openrouter.ai/credits')
  })

  it('opens the Muapi top-up page when the Studio balance is shown', () => {
    routeMock.view = 'studio'

    render(<TitlebarProfile />)

    openDropdown()
    fireEvent.click(screen.getByText('Top up Muapi'))

    expect(vi.mocked(openExternalLink)).toHaveBeenCalledWith('https://muapi.ai/access-keys')
  })
})
