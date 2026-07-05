import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { $studioBalanceVersion, resetStudioBalanceForTests } from '@/store/studio-balance'
import { $studioKey, resetStudioKeyForTests } from '@/store/studio-key'

import { StudioKeySetting } from './studio-key-setting'

afterEach(() => {
  cleanup()
  resetStudioKeyForTests()
  resetStudioBalanceForTests()
})

describe('StudioKeySetting', () => {
  it('shows the disconnected state and saves a trimmed key, refreshing the balance', () => {
    // '' = loaded, none stored (the async ensureStudioKeyLoaded no-ops on a non-null value).
    $studioKey.set('')
    render(<StudioKeySetting />)

    fireEvent.change(screen.getByPlaceholderText('Muapi API key'), { target: { value: '  sk-new  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect($studioKey.get()).toBe('sk-new')
    expect($studioBalanceVersion.get()).toBe(1)
  })

  it('does not offer Save for an empty draft', () => {
    $studioKey.set('')
    render(<StudioKeySetting />)

    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('masks a stored key and reveals an editable field to rotate it', () => {
    $studioKey.set('sk-existing')
    render(<StudioKeySetting />)

    const masked = screen.getByDisplayValue('••••••••') as HTMLInputElement
    expect(masked.readOnly).toBe(true)

    // Focus the masked field to rotate the key in place.
    fireEvent.focus(masked)
    fireEvent.change(screen.getByPlaceholderText('Muapi API key'), { target: { value: 'sk-rotated' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect($studioKey.get()).toBe('sk-rotated')
  })
})
