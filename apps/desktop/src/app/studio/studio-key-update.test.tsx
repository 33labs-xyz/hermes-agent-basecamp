import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const saveStudioKey = vi.hoisted(() => vi.fn())
const bumpStudioBalance = vi.hoisted(() => vi.fn())

vi.mock('@/store/studio-key', () => ({ saveStudioKey }))
vi.mock('@/store/studio-balance', () => ({ bumpStudioBalance }))

import { StudioKeyUpdate } from './studio-key-update'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StudioKeyUpdate', () => {
  it('reveals the form, saves a trimmed key, refreshes the balance, and collapses', () => {
    render(<StudioKeyUpdate />)

    fireEvent.click(screen.getByRole('button', { name: 'Update Muapi key' }))
    fireEvent.change(screen.getByPlaceholderText('Muapi API key'), { target: { value: '  sk-new  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(saveStudioKey).toHaveBeenCalledWith('sk-new')
    expect(bumpStudioBalance).toHaveBeenCalledTimes(1)
    expect(screen.queryByPlaceholderText('Muapi API key')).toBeNull()
  })

  it('does not save an empty key', () => {
    render(<StudioKeyUpdate />)

    fireEvent.click(screen.getByRole('button', { name: 'Update Muapi key' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(saveStudioKey).not.toHaveBeenCalled()
  })
})
