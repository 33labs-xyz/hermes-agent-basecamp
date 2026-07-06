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
    onRename: vi.fn(),
    onSelect: vi.fn(),
    tabs,
    ...overrides
  }
  render(<TerminalTabStrip {...props} />)

  return props
}

const renameInput = () => screen.getByRole('textbox', { name: 'Rename terminal' }) as HTMLInputElement

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

  it('double-click swaps the label for a rename input seeded with the custom name', () => {
    renderStrip({ labels: ['build', 'other'], tabs: [{ ...tabs[0], name: 'build' }, tabs[1]] })

    fireEvent.doubleClick(screen.getByText('build'))

    expect(renameInput().value).toBe('build')
  })

  it('commits a rename on Enter and closes the editor', () => {
    const { onRename } = renderStrip()

    fireEvent.doubleClick(screen.getByText('project'))
    const input = renameInput()
    // Auto-labelled tab has no custom name yet, so the editor starts empty.
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: 'api' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRename).toHaveBeenCalledWith('a', 'api')
    expect(screen.queryByRole('textbox', { name: 'Rename terminal' })).toBeNull()
  })

  it('commits on blur and cancels on Escape without renaming', () => {
    const { onRename } = renderStrip()

    fireEvent.doubleClick(screen.getByText('project'))
    fireEvent.keyDown(renameInput(), { key: 'Escape' })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Rename terminal' })).toBeNull()

    fireEvent.doubleClick(screen.getByText('project'))
    const input = renameInput()
    fireEvent.change(input, { target: { value: 'db' } })
    fireEvent.blur(input)
    expect(onRename).toHaveBeenCalledWith('a', 'db')
  })
})
