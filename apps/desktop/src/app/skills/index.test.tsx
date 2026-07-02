import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $createSkillOpen, $skillsRefreshSignal, bumpSkillsRefresh } from '@/store/create-skill'

const getSkills = vi.fn()
const getToolsets = vi.fn()
const toggleSkill = vi.fn()
const toggleToolset = vi.fn()
const getToolsetConfig = vi.fn()
const selectToolsetProvider = vi.fn()

vi.mock('@/hermes', () => ({
  getSkills: () => getSkills(),
  getToolsets: () => getToolsets(),
  toggleSkill: (name: string, enabled: boolean) => toggleSkill(name, enabled),
  toggleToolset: (name: string, enabled: boolean) => toggleToolset(name, enabled),
  getToolsetConfig: (name: string) => getToolsetConfig(name),
  selectToolsetProvider: (toolset: string, provider: string) => selectToolsetProvider(toolset, provider),
  deleteEnvVar: vi.fn(),
  revealEnvVar: vi.fn(),
  setEnvVar: vi.fn()
}))

// Notifications hit nanostores/timers we don't care about here.
vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))

function toolset(overrides: Record<string, unknown> = {}) {
  return {
    name: 'web',
    label: 'Web Search',
    description: 'web_search, web_extract',
    enabled: true,
    available: true,
    configured: true,
    tools: ['web_search', 'web_extract'],
    ...overrides
  }
}

function skill(overrides: Record<string, unknown> = {}) {
  return {
    name: 'weekly-report',
    description: 'Summarize the week',
    category: 'general',
    enabled: true,
    ...overrides
  }
}

function renderSkillsTab(tab: 'skills' | 'toolsets') {
  return import('./index').then(({ SkillsView }) =>
    render(
      <MemoryRouter initialEntries={[`/skills?tab=${tab}`]}>
        <SkillsView />
      </MemoryRouter>
    )
  )
}

function renderSkills() {
  return renderSkillsTab('toolsets')
}

beforeEach(() => {
  getSkills.mockResolvedValue([])
  getToolsets.mockResolvedValue([toolset()])
  toggleToolset.mockResolvedValue({ ok: true, name: 'web', enabled: false })
  getToolsetConfig.mockResolvedValue({ has_category: false, active_provider: null, providers: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SkillsView toolset management', () => {
  it('renders a switch for each toolset and toggles it off', async () => {
    await renderSkills()

    const sw = await screen.findByRole('switch', { name: 'Toggle Web Search toolset' })
    expect(sw.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(sw)

    await waitFor(() => expect(toggleToolset).toHaveBeenCalledWith('web', false))
  })

  it('renders toolset titles without leading emoji', async () => {
    getToolsets.mockResolvedValue([
      toolset({ name: 'cronjob', label: '⏰ Cron Jobs', description: 'cron tools' })
    ])

    await renderSkills()

    expect(await screen.findByText('Cron Jobs')).toBeTruthy()
    expect(screen.queryByText(/⏰/)).toBeNull()
  })

  it('keeps the configured pill alongside the switch', async () => {
    await renderSkills()

    await screen.findByRole('switch', { name: 'Toggle Web Search toolset' })
    expect(screen.getByText('Configured')).toBeTruthy()
  })

  it('expands the provider config panel when the configured pill is clicked', async () => {
    await renderSkills()

    const configureBtn = await screen.findByRole('button', { name: 'Configure Web Search' })
    fireEvent.click(configureBtn)

    await waitFor(() => expect(getToolsetConfig).toHaveBeenCalledWith('web'))
  })
})

describe('SkillsView create skill', () => {
  afterEach(() => {
    $createSkillOpen.set(false)
    $skillsRefreshSignal.set(0)
  })

  it('opens the create wizard from the trailing Create button', async () => {
    getSkills.mockResolvedValue([skill()])
    await renderSkillsTab('skills')

    const btn = await screen.findByRole('button', { name: 'Create skill' })
    fireEvent.click(btn)

    expect($createSkillOpen.get()).toBe(true)
  })

  it('offers a Create button in the empty state when there are no skills', async () => {
    getSkills.mockResolvedValue([])
    await renderSkillsTab('skills')

    const btn = await screen.findByRole('button', { name: 'Create skill' })
    fireEvent.click(btn)

    expect($createSkillOpen.get()).toBe(true)
  })

  it('refetches skills when the refresh signal bumps', async () => {
    getSkills.mockResolvedValue([skill()])
    await renderSkillsTab('skills')

    await waitFor(() => expect(getSkills).toHaveBeenCalledTimes(1))

    act(() => bumpSkillsRefresh())

    await waitFor(() => expect(getSkills).toHaveBeenCalledTimes(2))
  })
})
