import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  $terminalSessions,
  ensureTerminalSessionsLoaded,
  forgetSession,
  forkSession,
  resumeSession,
  type TerminalSession
} from '@/store/terminal-sessions'

import { RightSidebarSectionHeader } from '../index'

import { SessionTranscript } from './session-transcript'

// Projects -> sessions list with a read-only transcript and Resume/Fork/Forget.
// Hardcoded English copy (tester-scoped; not routed through i18n on purpose).
export function SessionsPanel() {
  const payload = useStore($terminalSessions)
  const [openId, setOpenId] = useState<null | string>(null)

  useEffect(() => {
    ensureTerminalSessionsLoaded()
  }, [])

  if (!payload) {
    return <div className="px-3 py-2 text-[0.68rem] text-muted-foreground/70">Loading sessions...</div>
  }

  if (payload.sessions.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
        <div className="text-[0.7rem] font-semibold uppercase tracking-[0.07em] text-muted-foreground/75">
          No sessions yet
        </div>
        <div className="text-[0.68rem] leading-relaxed text-muted-foreground/65">
          Run <code>claude</code> in the built-in terminal and it shows up here.
        </div>
      </div>
    )
  }

  const sessionsByProject = new Map<string, TerminalSession[]>()
  for (const session of payload.sessions) {
    const list = sessionsByProject.get(session.projectPath) ?? []
    list.push(session)
    sessionsByProject.set(session.projectPath, list)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {payload.projects.map(project => (
        <div key={project.path} className="flex flex-col">
          <RightSidebarSectionHeader>
            <div className="min-w-0 flex-1 truncate text-[0.72rem] font-semibold text-(--ui-text-secondary)">
              {project.name}
            </div>
            <span className="text-[0.62rem] text-muted-foreground/60">{project.sessionCount}</span>
          </RightSidebarSectionHeader>
          {(sessionsByProject.get(project.path) ?? []).map(session => (
            <div key={session.id} className="flex flex-col border-b border-(--ui-stroke-secondary)/40">
              <button
                className="flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent/40"
                onClick={() => setOpenId(openId === session.id ? null : session.id)}
                type="button"
              >
                <Codicon name={openId === session.id ? 'chevron-down' : 'chevron-right'} size="0.75rem" />
                <span className="min-w-0 flex-1 truncate text-[0.72rem] text-(--ui-text-secondary)">
                  {session.title}
                </span>
                <span className="text-[0.6rem] text-muted-foreground/55">{session.messageCount}</span>
              </button>
              {openId === session.id && (
                <div className="flex flex-col gap-1 pb-2">
                  <div className="flex gap-1 px-3">
                    <Button onClick={() => resumeSession(session.id)} size="xs" type="button" variant="secondary">
                      Resume
                    </Button>
                    <Button
                      onClick={() => void forkSession(session.id, session.projectPath)}
                      size="xs"
                      type="button"
                      variant="ghost"
                    >
                      Fork
                    </Button>
                    <Button
                      className="ml-auto"
                      onClick={() => {
                        const hard = window.confirm('Delete this session transcript permanently? This cannot be undone.')
                        void forgetSession(session.id, hard)
                      }}
                      size="xs"
                      type="button"
                      variant="ghost"
                    >
                      Forget
                    </Button>
                  </div>
                  <SessionTranscript sessionId={session.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
