import { atom } from 'nanostores'

import { runInTerminal } from '@/app/right-sidebar/store'

export interface TerminalProject {
  path: string
  name: string
  sessionCount: number
  lastActiveAt: number
  gitBranch: string
}

export interface TerminalSession {
  id: string
  title: string
  startedAt: number
  lastActiveAt: number
  messageCount: number
  cwd: string
  gitBranch: string
  transcriptPath: string
  transcriptAvailable: boolean
  projectPath: string
}

export interface TerminalTurn {
  role: 'assistant' | 'user'
  text: string
  ts: string
}

interface SessionsPayload {
  projects: TerminalProject[]
  sessions: TerminalSession[]
}

export const $terminalSessions = atom<SessionsPayload | null>(null)

// `claude --resume <id>` resolves the session by id regardless of the terminal's
// cwd, so Resume/Fork just inject into the active built-in terminal.
export function resumeCommand(id: string): string {
  return `claude --resume ${id}`
}

// Compose the crux `--session-id` with `--fork-session` so the branch is tracked
// (its newId enters launches.jsonl via recordFork). If a future claude drops the
// composition, degrade to `claude --resume <fromId> --fork-session` (untracked).
export function forkCommand(fromId: string, newId: string): string {
  return `claude --resume ${fromId} --fork-session --session-id ${newId}`
}

let loadStarted = false

export async function refreshTerminalSessions(): Promise<void> {
  try {
    const payload = await window.hermesDesktop?.terminalSessions?.list()
    $terminalSessions.set((payload as SessionsPayload) ?? { projects: [], sessions: [] })
  } catch {
    $terminalSessions.set({ projects: [], sessions: [] })
  }
}

export function ensureTerminalSessionsLoaded(): void {
  if (loadStarted) {
    return
  }
  loadStarted = true
  void refreshTerminalSessions()
  window.hermesDesktop?.terminalSessions?.onChanged(() => void refreshTerminalSessions())
}

export function resumeSession(id: string): void {
  runInTerminal(resumeCommand(id))
}

export async function forkSession(fromId: string, projectPath: string): Promise<void> {
  const newId = crypto.randomUUID()
  await window.hermesDesktop?.terminalSessions?.recordFork({ newId, fromId, projectPath })
  runInTerminal(forkCommand(fromId, newId))
}

export async function forgetSession(id: string, deleteTranscript: boolean): Promise<void> {
  await window.hermesDesktop?.terminalSessions?.forget(id, { deleteTranscript })
  await refreshTerminalSessions()
}

// Test-only: reset module load latch.
export function resetTerminalSessionsForTests(): void {
  loadStarted = false
  $terminalSessions.set(null)
}
