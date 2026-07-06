import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $terminalSessions, resetTerminalSessionsForTests } from '@/store/terminal-sessions'

import { SessionsPanel } from './terminal/sessions-panel'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  resetTerminalSessionsForTests()
  ;(window as unknown as Record<string, unknown>).hermesDesktop = {
    terminalSessions: {
      list: vi.fn().mockResolvedValue({ projects: [], sessions: [] }),
      getTranscript: vi.fn().mockResolvedValue([]),
      forget: vi.fn().mockResolvedValue(true),
      recordFork: vi.fn().mockResolvedValue(true),
      onChanged: vi.fn().mockReturnValue(() => {})
    }
  }
})

describe('SessionsPanel', () => {
  it('renders a project with its sessions', () => {
    $terminalSessions.set({
      projects: [{ path: '/x/proj', name: 'proj', sessionCount: 1, lastActiveAt: 2, gitBranch: 'main' }],
      sessions: [
        {
          id: 'id-1',
          title: 'Fix login',
          startedAt: 1,
          lastActiveAt: 2,
          messageCount: 3,
          cwd: '/x/proj',
          gitBranch: 'main',
          transcriptPath: '/t/id-1.jsonl',
          transcriptAvailable: true,
          projectPath: '/x/proj'
        }
      ]
    })
    render(<SessionsPanel />)
    expect(screen.getByText('proj')).toBeTruthy()
    expect(screen.getByText('Fix login')).toBeTruthy()
  })

  it('shows an empty state when there are no sessions', () => {
    $terminalSessions.set({ projects: [], sessions: [] })
    render(<SessionsPanel />)
    expect(screen.getByText(/No Claude sessions yet/i)).toBeTruthy()
  })
})

import { $rightSidebarView, setRightSidebarView } from './store'

describe('rightSidebar view store', () => {
  it('defaults to files and switches to sessions', () => {
    setRightSidebarView('files')
    expect($rightSidebarView.get()).toBe('files')
    setRightSidebarView('sessions')
    expect($rightSidebarView.get()).toBe('sessions')
  })
})
