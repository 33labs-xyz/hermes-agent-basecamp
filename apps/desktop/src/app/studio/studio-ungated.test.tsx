import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $studioKey, resetStudioKeyForTests } from '@/store/studio-key'

import { StudioView } from './index'

// Every vendored studio stubs down to a prompt box so typing-trigger behavior
// is testable without mounting the heavy Muapi JSX.
vi.mock('./vendor', () => {
  const StudioStub = ({ apiKey }: { apiKey: string }) => (
    <div>
      <input aria-label="prompt" />
      <span data-testid="stub-api-key">{apiKey}</span>
    </div>
  )

  return {
    AgentProfile: StudioStub,
    AgentStudio: StudioStub,
    AiAgent: StudioStub,
    AudioStudio: StudioStub,
    CinemaStudio: StudioStub,
    CreateAgentPage: StudioStub,
    DesignAgentStudio: StudioStub,
    EditAgentPage: StudioStub,
    ImageStudio: StudioStub,
    MarketingStudio: StudioStub,
    RecastStudio: StudioStub,
    VibeMotionStudio: StudioStub,
    VideoStudio: StudioStub,
    WorkflowStudio: StudioStub,
    getAgentDetails: vi.fn(async () => ({})),
    getConversationHistory: vi.fn(async () => null),
    getUserBalance: vi.fn(async () => ({ balance: 0 }))
  }
})
vi.mock('./library', () => ({ StudioLibrary: () => null }))
vi.mock('./studio-credits', () => ({ StudioCredits: () => null }))

beforeEach(() => {
  resetStudioKeyForTests()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderStudio() {
  return render(<StudioView setStatusbarItemGroup={vi.fn()} />)
}

describe('StudioView ungated', () => {
  it('renders studio tabs immediately without a key', async () => {
    renderStudio()

    expect(await screen.findByRole('button', { name: 'Image' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Video' })).toBeTruthy()
    expect(screen.queryByTestId('studio-key-overlay')).toBeNull()
    expect(screen.queryByText('Connect Studio')).toBeNull()
  })

  // Regression guard: the tab bar shares the titlebar strip, so its right edge
  // must reserve room for the floating window-control cluster or the credits
  // pill slides under it (the 0.15.13 top-corner overlap). The reservation
  // tracks --titlebar-tools-width, matching titlebarHeaderBaseClass.
  it('reserves right-edge space for the floating titlebar controls', async () => {
    renderStudio()

    const tabList = (await screen.findByRole('button', { name: 'Image' })).parentElement
    const tabBarRow = tabList?.parentElement

    expect(tabBarRow?.className).toContain('--titlebar-tools-width')
  })

  it('opens the key prompt when typing without a key', async () => {
    renderStudio()

    fireEvent.input(await screen.findByLabelText('prompt'), { target: { value: 'a cat' } })

    expect(screen.getByTestId('studio-key-overlay')).toBeTruthy()
    expect(screen.getByText('Connect Studio')).toBeTruthy()
  })

  it('does not prompt when a key is already stored', async () => {
    $studioKey.set('sk-live')
    renderStudio()

    fireEvent.input(await screen.findByLabelText('prompt'), { target: { value: 'a cat' } })

    expect(screen.queryByTestId('studio-key-overlay')).toBeNull()
    expect(screen.getByTestId('stub-api-key').textContent).toBe('sk-live')
  })

  it('saves the submitted key and closes the prompt', async () => {
    renderStudio()

    fireEvent.input(await screen.findByLabelText('prompt'), { target: { value: 'a cat' } })
    fireEvent.change(screen.getByPlaceholderText('Muapi API key'), { target: { value: 'sk-new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    expect(screen.queryByTestId('studio-key-overlay')).toBeNull()
    expect($studioKey.get()).toBe('sk-new')
    expect(screen.getByTestId('stub-api-key').textContent).toBe('sk-new')
  })

  it('stays dismissed for the tab, re-arms on tab switch', async () => {
    renderStudio()

    const prompt = await screen.findByLabelText('prompt')

    fireEvent.input(prompt, { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('studio-key-overlay')).toBeNull()

    // Same tab: typing again stays quiet.
    fireEvent.input(screen.getByLabelText('prompt'), { target: { value: 'ab' } })
    expect(screen.queryByTestId('studio-key-overlay')).toBeNull()

    // New tab: prompt re-arms.
    fireEvent.click(screen.getByRole('button', { name: 'Video' }))
    fireEvent.input(screen.getByLabelText('prompt'), { target: { value: 'b' } })
    expect(screen.getByTestId('studio-key-overlay')).toBeTruthy()
  })
})

// Workflows/Agents/Design fetch account data on mount, so without a key they
// render the connect pane in place of the studio (no typing-trigger overlay).
describe('StudioView hard-gated tabs', () => {
  it('renders the connect pane instead of the studio without a key', async () => {
    renderStudio()

    fireEvent.click(await screen.findByRole('button', { name: 'Workflows' }))

    expect(screen.getByText('Connect Studio')).toBeTruthy()
    expect(screen.queryByLabelText('prompt')).toBeNull()

    // Typing the key into the in-pane gate must not stack the overlay on top.
    fireEvent.input(screen.getByPlaceholderText('Muapi API key'), { target: { value: 'sk' } })
    expect(screen.queryByTestId('studio-key-overlay')).toBeNull()

    // Connecting through the pane swaps in the studio.
    fireEvent.change(screen.getByPlaceholderText('Muapi API key'), { target: { value: 'sk-flow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(screen.getByTestId('stub-api-key').textContent).toBe('sk-flow')
  })

  it('renders the studio directly when a key is stored', async () => {
    $studioKey.set('sk-live')
    renderStudio()

    fireEvent.click(await screen.findByRole('button', { name: 'Workflows' }))

    expect(screen.queryByText('Connect Studio')).toBeNull()
    expect(screen.getByTestId('stub-api-key').textContent).toBe('sk-live')
  })
})
