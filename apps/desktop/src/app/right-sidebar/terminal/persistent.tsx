import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { setTerminalTakeover } from '../store'

import { TerminalTab } from './index'
import { TerminalTabStrip } from './terminal-tab-strip'
import {
  activateTab,
  canOpenTab,
  closeTab,
  computeTabLabels,
  initTabs,
  openTab,
  type TerminalTabsState
} from './terminal-tabs'

/**
 * One xterm Terminal per tab, all mounted at the layout root and CSS-overlayed
 * onto whichever `<TerminalSlot />` is active. Moving the host DOM detaches
 * xterm's WebGL renderer (it observes its own attachment) and resets the
 * screen, so the hosts stay put and we chase the slot's bounding rect with
 * position:fixed. Only the active tab is visible; the others stay mounted and
 * sized (visibility:hidden, never display:none) so switching tabs never
 * reflows or rebuilds a shell.
 */

const $slot = atom<HTMLElement | null>(null)

const SLOT_CLASS = 'relative flex min-h-0 min-w-0 flex-1 flex-col'

export function TerminalSlot({ className = SLOT_CLASS }: { className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current

    if (!el) {
      return
    }

    $slot.set(el)

    return () => {
      if ($slot.get() === el) {
        $slot.set(null)
      }
    }
  }, [])

  return <div className={className} ref={ref} />
}

interface PersistentTerminalProps {
  cwd: string
  onAddSelectionToChat: (text: string, label?: string) => void
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const sameRect = (a: Rect | null, b: Rect) =>
  !!a && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height

export function PersistentTerminal({ cwd, onAddSelectionToChat }: PersistentTerminalProps) {
  const slot = useStore($slot)
  const [rect, setRect] = useState<Rect | null>(null)
  const [ready, setReady] = useState(false)
  const [tabsState, setTabsState] = useState<TerminalTabsState | null>(null)
  const makeIdRef = useRef(0)
  const makeId = useCallback(() => `term-${(makeIdRef.current += 1)}`, [])
  const latestCwdRef = useRef(cwd)

  useEffect(() => {
    latestCwdRef.current = cwd
  }, [cwd])

  useLayoutEffect(() => {
    if (!slot) {
      setRect(null)

      return
    }

    let prev: Rect | null = null
    let frame = 0

    const tick = () => {
      const r = slot.getBoundingClientRect()
      // floor top/left + ceil right/bottom: overlay always covers the slot's
      // full pixel footprint, so half-pixel rects can't leak page bg through.
      const top = Math.floor(r.top)
      const left = Math.floor(r.left)
      const next: Rect = { top, left, width: Math.ceil(r.right) - left, height: Math.ceil(r.bottom) - top }

      if (!sameRect(prev, next)) {
        prev = next
        setRect(next)

        if (next.width > 0 && next.height > 0) {
          setReady(true)
        }
      }

      frame = requestAnimationFrame(tick)
    }

    tick()

    return () => cancelAnimationFrame(frame)
  }, [slot])

  // Lazy-seed tab 1 once we have real dims AND a non-empty cwd. Seeding before
  // cwd resolves would pin tab 1 to '' (home dir); waiting for the first
  // non-empty cwd pins it to the real workspace. Runs once — after seeding,
  // tabsState is non-null and this bails. New tabs are opened explicitly via "+".
  useEffect(() => {
    if (tabsState || !ready || !cwd.trim()) {
      return
    }

    setTabsState(initTabs(cwd, makeId))
  }, [cwd, makeId, ready, tabsState])

  const handleOpen = () =>
    setTabsState(state => (state ? openTab(state, latestCwdRef.current, makeId) : state))
  const handleClose = (id: string) => setTabsState(state => (state ? closeTab(state, id) : state))
  const handleSelect = (id: string) => setTabsState(state => (state ? activateTab(state, id) : state))
  const handleHide = () => setTerminalTakeover(false)

  const visible = Boolean(rect && rect.width > 0 && rect.height > 0)

  const style: CSSProperties = {
    position: 'fixed',
    top: rect?.top ?? 0,
    left: rect?.left ?? 0,
    width: rect?.width ?? 0,
    height: rect?.height ?? 0,
    display: 'flex',
    flexDirection: 'column',
    visibility: visible ? 'visible' : 'hidden',
    pointerEvents: visible ? 'auto' : 'none',
    zIndex: 4,
    // Match the live skin surface so the strip (transparent) and bodies read as
    // one cohesive pane instead of revealing a near-black slab behind.
    backgroundColor: 'var(--ui-editor-surface-background)',
    contain: 'layout size paint'
  }

  // Defer seeding until real dims — booting xterm at 0×0 starts the shell at
  // 80×24, then the first ResizeObserver SIGWINCH redraws the prompt on a new
  // line. Every tab stays mounted forever once created; only visibility flips.
  return (
    <div aria-hidden={!visible} style={style}>
      {tabsState && (
        <>
          <TerminalTabStrip
            activeId={tabsState.activeId}
            canOpen={canOpenTab(tabsState)}
            labels={computeTabLabels(tabsState.tabs)}
            onClose={handleClose}
            onHide={handleHide}
            onOpen={handleOpen}
            onSelect={handleSelect}
            tabs={tabsState.tabs}
          />
          <div className="relative min-h-0 flex-1">
            {tabsState.tabs.map(tab => (
              <div
                className="absolute inset-0 flex flex-col"
                key={tab.id}
                style={{ visibility: tab.id === tabsState.activeId ? 'visible' : 'hidden' }}
              >
                <TerminalTab
                  cwd={tab.cwd}
                  isActive={tab.id === tabsState.activeId}
                  onAddSelectionToChat={onAddSelectionToChat}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
