import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StudioKeyGate } from './index'

// The studio barrel drags in every vendored Muapi studio; the key gate needs
// none of them.
vi.mock('./vendor', () => ({
  AgentProfile: () => null,
  AgentStudio: () => null,
  AiAgent: () => null,
  AudioStudio: () => null,
  CinemaStudio: () => null,
  CreateAgentPage: () => null,
  DesignAgentStudio: () => null,
  EditAgentPage: () => null,
  ImageStudio: () => null,
  MarketingStudio: () => null,
  RecastStudio: () => null,
  VibeMotionStudio: () => null,
  VideoStudio: () => null,
  WorkflowStudio: () => null,
  getAgentDetails: vi.fn(),
  getConversationHistory: vi.fn(),
  getUserBalance: vi.fn()
}))
vi.mock('./library', () => ({ StudioLibrary: () => null }))
vi.mock('./studio-credits', () => ({ StudioCredits: () => null }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StudioKeyGate', () => {
  it('links to the Muapi access-keys page for users without a key', () => {
    render(<StudioKeyGate onSubmit={vi.fn()} />)

    const link = screen.getByRole('link', { name: /get a muapi api key/i }) as HTMLAnchorElement

    expect(link.href).toBe('https://muapi.ai/access-keys')
    expect(link.target).toBe('_blank')
  })

  it('submits the trimmed key on Connect', () => {
    const onSubmit = vi.fn()

    render(<StudioKeyGate onSubmit={onSubmit} />)

    fireEvent.change(screen.getByPlaceholderText('Muapi API key'), { target: { value: '  sk-123  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    expect(onSubmit).toHaveBeenCalledWith('sk-123')
  })
})
