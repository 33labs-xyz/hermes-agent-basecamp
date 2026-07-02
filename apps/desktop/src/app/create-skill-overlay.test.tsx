import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $createSkillOpen } from '@/store/create-skill'
import { $gatewayState } from '@/store/session'

vi.mock('@/hermes', () => ({ createSkill: vi.fn() }))
vi.mock('@/store/notifications', () => ({ notify: vi.fn(), notifyError: vi.fn() }))

import { CreateSkillOverlay } from './create-skill-overlay'

afterEach(() => {
  cleanup()
  $createSkillOpen.set(false)
  $gatewayState.set('idle')
})

describe('CreateSkillOverlay', () => {
  it('renders nothing while the gateway is not open', () => {
    $gatewayState.set('idle')
    $createSkillOpen.set(true)
    render(<CreateSkillOverlay />)
    expect(screen.queryByText('Create a skill')).toBeNull()
  })

  it('shows the wizard when the gateway is open and the open flag is set', () => {
    $gatewayState.set('open')
    $createSkillOpen.set(true)
    render(<CreateSkillOverlay />)
    expect(screen.getByText('Create a skill')).toBeTruthy()
  })
})
