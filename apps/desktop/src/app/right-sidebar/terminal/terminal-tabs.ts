// Pure, immutable model for the terminal tab strip. No React, no xterm, no PTY.
// `id` here is a renderer-side handle (injected via makeId) used only as a React
// key and for activate/close targeting — it is deliberately separate from the
// PTY session id that main.cjs assigns, so this stays trivially unit-testable.
export interface TerminalTabModel {
  id: string
  cwd: string
  // User-assigned label (via rename). Wins over the cwd-derived label; absent
  // means "auto" and the tab falls back to basename(cwd) + dup suffixing.
  name?: string
}

export interface TerminalTabsState {
  tabs: TerminalTabModel[]
  activeId: string
}

// Soft cap on concurrent terminals. The "+" control is disabled at this count.
export const MAX_TERMINAL_TABS = 8

export function initTabs(cwd: string, makeId: () => string): TerminalTabsState {
  const id = makeId()

  return { tabs: [{ id, cwd }], activeId: id }
}

export function canOpenTab(state: TerminalTabsState, max: number = MAX_TERMINAL_TABS): boolean {
  return state.tabs.length < max
}

export function openTab(
  state: TerminalTabsState,
  cwd: string,
  makeId: () => string,
  max: number = MAX_TERMINAL_TABS
): TerminalTabsState {
  if (!canOpenTab(state, max)) {
    return state
  }

  const id = makeId()

  return { tabs: [...state.tabs, { id, cwd }], activeId: id }
}

export function closeTab(state: TerminalTabsState, id: string): TerminalTabsState {
  // Always keep at least one terminal.
  if (state.tabs.length <= 1) {
    return state
  }

  const idx = state.tabs.findIndex(tab => tab.id === id)

  if (idx < 0) {
    return state
  }

  const tabs = state.tabs.filter(tab => tab.id !== id)

  // Closing a background tab leaves the active one alone. Closing the active tab
  // falls to the left neighbour, or the right one if we closed the first tab.
  const activeId =
    id !== state.activeId ? state.activeId : idx > 0 ? tabs[idx - 1].id : tabs[0].id

  return { tabs, activeId }
}

export function activateTab(state: TerminalTabsState, id: string): TerminalTabsState {
  if (!state.tabs.some(tab => tab.id === id)) {
    return state
  }

  return { ...state, activeId: id }
}

// A blank name clears the custom label so the tab reverts to its auto label.
export function renameTab(state: TerminalTabsState, id: string, name: string): TerminalTabsState {
  const target = state.tabs.find(tab => tab.id === id)
  const trimmed = name.trim()

  if (!target || trimmed === (target.name ?? '')) {
    return state
  }

  const tabs = state.tabs.map(tab => {
    if (tab.id !== id) {
      return tab
    }

    const { name: _cleared, ...bare } = tab

    return trimmed ? { ...bare, name: trimmed } : bare
  })

  return { ...state, tabs }
}

function basename(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)

  return parts.length ? parts[parts.length - 1] : 'shell'
}

export function computeTabLabels(tabs: TerminalTabModel[]): string[] {
  const counts = new Map<string, number>()

  return tabs.map(tab => {
    // Custom names render verbatim and stay out of the duplicate-count pool —
    // only auto labels number among themselves.
    if (tab.name) {
      return tab.name
    }

    const base = basename(tab.cwd)
    const n = (counts.get(base) ?? 0) + 1
    counts.set(base, n)

    return n === 1 ? base : `${base} ${n}`
  })
}
