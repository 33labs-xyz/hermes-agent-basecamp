import { useEffect, useState } from 'react'

import type { TerminalTurn } from '@/store/terminal-sessions'

// Read-only transcript render. Hardcoded English copy (tester-scoped feature;
// not routed through i18n to keep the diff contained).
export function SessionTranscript({ sessionId }: { sessionId: string }) {
  const [turns, setTurns] = useState<TerminalTurn[] | null>(null)

  useEffect(() => {
    let live = true
    setTurns(null)
    void window.hermesDesktop?.terminalSessions
      ?.getTranscript(sessionId)
      .then(result => {
        if (live) {
          setTurns(result ?? [])
        }
      })

    return () => {
      live = false
    }
  }, [sessionId])

  if (turns === null) {
    return <div className="px-3 py-2 text-[0.68rem] text-muted-foreground/70">Loading transcript...</div>
  }

  if (turns.length === 0) {
    return <div className="px-3 py-2 text-[0.68rem] text-muted-foreground/70">No transcript on disk.</div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
      {turns.map((turn, index) => (
        <div className="text-[0.72rem] leading-relaxed" key={index}>
          <div className="mb-0.5 font-semibold uppercase tracking-[0.06em] text-muted-foreground/60">
            {turn.role}
          </div>
          <div className="whitespace-pre-wrap text-(--ui-text-secondary)">{turn.text}</div>
        </div>
      ))}
    </div>
  )
}
