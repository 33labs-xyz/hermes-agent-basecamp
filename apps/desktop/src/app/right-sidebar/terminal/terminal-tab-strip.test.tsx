import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TerminalTabStrip } from './terminal-tab-strip'

afterEach(cleanup)

const tabs = [
  { id: 'a', cwd: '/Users/me/project' },
  { id: 'b', cwd: '/Users/me/other' }
]

function renderStrip(overrides: Partial<React.ComponentProps<typeof TerminalTabStrip>> = {}) {
  const props = {
    activeId: 'a',
    canOpen: true,
    labels: ['project', 'other'],
    onClose: vi.fn(),
    onHide: vi.fn(),
    onOpen: vi.fn(),
    onSelect: vi.fn(),
    tabs,
    ...overrides
  }
  render(<TerminalTabStrip {...props} />)

  return props
}

describe('TerminalTabStrip', () => {
  it('renders one labelled chip per tab', () => {
    renderStrip()

    expect(screen.getByText('project')).toBeTruthy()
    expect(screen.getByText('other')).toBeTruthy()
  })

  it('calls onSelect with the tab id when a chip is clicked', () => {
    const { onSelect } = renderStrip()

    fireEvent.click(screen.getByText('other'))

    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('shows per-tab close controls only when more than one tab is open', () => {
    renderStrip()
    expect(screen.getAllByRole('button', { name: 'Close terminal' })).toHaveLength(2)

    cleanup()

    renderStrip({ tabs: [tabs[0]], labels: ['project'] })
    expect(screen.queryByRole('button', { name: 'Close terminal' })).toBeNull()
  })

  it('calls onOpen from the "+" control and disables it at the cap', () => {
    const { onOpen } = renderStrip()
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    expect(onOpen).toHaveBeenCalledTimes(1)

    cleanup()

    renderStrip({ canOpen: false })
    expect(screen.getByRole('button', { name: 'New terminal' })).toHaveProperty('disabled', true)
  })

  it('calls onHide from the hide control', () => {
    const { onHide } = renderStrip()

    fireEvent.click(screen.getByRole('button', { name: 'Hide terminal' }))

    expect(onHide).toHaveBeenCalledTimes(1)
  })
})
