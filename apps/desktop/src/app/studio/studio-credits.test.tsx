import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StudioCredits } from './studio-credits'
import { getUserBalance } from './vendor/muapi.js'

// The balance hook imports the muapi transport module directly (not the
// barrel) so shell consumers don't drag studio JSX in; mock the same path.
vi.mock('./vendor/muapi.js', () => ({ getUserBalance: vi.fn() }))

const mockGetUserBalance = vi.mocked(getUserBalance)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StudioCredits', () => {
  it('renders the balance labelled as credits once loaded', async () => {
    mockGetUserBalance.mockResolvedValue({ balance: 42.5 })

    render(<StudioCredits apiKey="key" refreshSignal={0} />)

    await waitFor(() => expect(screen.getByText('42.5')).toBeTruthy())
    expect(screen.getByText(/credits/i)).toBeTruthy()
    expect(mockGetUserBalance).toHaveBeenCalledWith('key')
  })

  it('formats whole and large balances with grouping', async () => {
    mockGetUserBalance.mockResolvedValue({ balance: 1234 })

    render(<StudioCredits apiKey="key" refreshSignal={0} />)

    await waitFor(() => expect(screen.getByText('1,234')).toBeTruthy())
  })

  it('renders nothing when the lookup fails (bad or expired key)', async () => {
    mockGetUserBalance.mockRejectedValue(new Error('401 unauthorized'))

    const { container } = render(<StudioCredits apiKey="key" refreshSignal={0} />)

    await waitFor(() => expect(mockGetUserBalance).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('[data-testid="studio-credits"]')).toBeNull())
  })

  it('renders nothing and skips the lookup when no key is connected', () => {
    const { container } = render(<StudioCredits apiKey={null} refreshSignal={0} />)

    expect(mockGetUserBalance).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="studio-credits"]')).toBeNull()
  })

  it('refetches when the refresh signal changes', async () => {
    mockGetUserBalance.mockResolvedValue({ balance: 10 })

    const { rerender } = render(<StudioCredits apiKey="key" refreshSignal={0} />)
    await waitFor(() => expect(mockGetUserBalance).toHaveBeenCalledTimes(1))

    rerender(<StudioCredits apiKey="key" refreshSignal={1} />)
    await waitFor(() => expect(mockGetUserBalance).toHaveBeenCalledTimes(2))
  })
})
