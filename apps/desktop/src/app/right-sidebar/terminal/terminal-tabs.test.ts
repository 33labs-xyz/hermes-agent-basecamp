import { describe, expect, it } from 'vitest'

import {
  activateTab,
  canOpenTab,
  closeTab,
  computeTabLabels,
  initTabs,
  MAX_TAB_NAME_LENGTH,
  MAX_TERMINAL_TABS,
  openTab,
  renameTab
} from './terminal-tabs'

// Deterministic id factory so assertions can name ids.
function counter() {
  let n = 0
  return () => `id-${(n += 1)}`
}

describe('terminal-tabs model', () => {
  it('initTabs starts with one active tab pinned to the cwd', () => {
    const state = initTabs('/Users/me/project', counter())

    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].cwd).toBe('/Users/me/project')
    expect(state.activeId).toBe(state.tabs[0].id)
  })

  it('openTab appends a tab pinned to the given cwd and activates it', () => {
    const make = counter()
    const start = initTabs('/a', make)
    const next = openTab(start, '/b', make)

    expect(next.tabs.map(t => t.cwd)).toEqual(['/a', '/b'])
    expect(next.activeId).toBe(next.tabs[1].id)
    // Immutable: original untouched.
    expect(start.tabs).toHaveLength(1)
  })

  it('canOpenTab is false at the cap and openTab is then a no-op', () => {
    const make = counter()
    let state = initTabs('/a', make)
    for (let i = 1; i < MAX_TERMINAL_TABS; i += 1) {
      state = openTab(state, `/dir-${i}`, make)
    }

    expect(state.tabs).toHaveLength(MAX_TERMINAL_TABS)
    expect(canOpenTab(state)).toBe(false)
    expect(openTab(state, '/overflow', make)).toBe(state)
  })

  it('closeTab removes a background tab and keeps the active one', () => {
    const make = counter()
    let state = initTabs('/a', make) // id-1 active
    state = openTab(state, '/b', make) // id-2 active
    const closed = closeTab(state, state.tabs[0].id) // close id-1 (background)

    expect(closed.tabs.map(t => t.cwd)).toEqual(['/b'])
    expect(closed.activeId).toBe(state.activeId) // still id-2
  })

  it('closing the active tab falls to the left neighbour', () => {
    const make = counter()
    let state = initTabs('/a', make)
    state = openTab(state, '/b', make)
    state = openTab(state, '/c', make) // tabs: a,b,c ; active c
    state = activateTab(state, state.tabs[1].id) // active b (middle)
    const closed = closeTab(state, state.tabs[1].id) // close b

    expect(closed.tabs.map(t => t.cwd)).toEqual(['/a', '/c'])
    expect(closed.activeId).toBe(closed.tabs[0].id) // left neighbour a
  })

  it('closing the active first tab falls to the right neighbour', () => {
    const make = counter()
    let state = initTabs('/a', make)
    state = openTab(state, '/b', make)
    state = activateTab(state, state.tabs[0].id) // active a (first)
    const closed = closeTab(state, state.tabs[0].id) // close a

    expect(closed.tabs.map(t => t.cwd)).toEqual(['/b'])
    expect(closed.activeId).toBe(closed.tabs[0].id) // right neighbour b
  })

  it('closeTab is a no-op when only one tab remains', () => {
    const state = initTabs('/a', counter())

    expect(closeTab(state, state.tabs[0].id)).toBe(state)
  })

  it('closeTab ignores an unknown id', () => {
    const make = counter()
    let state = initTabs('/a', make)
    state = openTab(state, '/b', make)

    expect(closeTab(state, 'nope')).toBe(state)
  })

  it('activateTab switches to an existing id and ignores unknown ids', () => {
    const make = counter()
    let state = initTabs('/a', make)
    state = openTab(state, '/b', make)
    const first = state.tabs[0].id

    expect(activateTab(state, first).activeId).toBe(first)
    expect(activateTab(state, 'nope')).toBe(state)
  })

  it('computeTabLabels uses the cwd basename, empty -> shell, with dup suffixes', () => {
    const labels = computeTabLabels([
      { id: '1', cwd: '/Users/me/project' },
      { id: '2', cwd: '/Users/other/project' },
      { id: '3', cwd: '/' },
      { id: '4', cwd: '/Users/me/project/' },
      { id: '5', cwd: '' }
    ])

    expect(labels).toEqual(['project', 'project 2', 'shell', 'project 3', 'shell 2'])
  })

  it('renameTab sets a trimmed custom name that computeTabLabels prefers', () => {
    const make = counter()
    let state = initTabs('/a/project', make)
    state = openTab(state, '/b/project', make)
    const before = state
    state = renameTab(state, state.tabs[0].id, ' build ')

    expect(state.tabs[0].name).toBe('build')
    // Immutable: original untouched.
    expect(before.tabs[0].name).toBeUndefined()
    // Custom name used verbatim; auto labels number among themselves only.
    expect(computeTabLabels(state.tabs)).toEqual(['build', 'project'])
  })

  it('renameTab with a blank name clears back to the auto label', () => {
    const make = counter()
    let state = initTabs('/a/project', make)
    state = renameTab(state, state.tabs[0].id, 'build')
    state = renameTab(state, state.tabs[0].id, '   ')

    expect(state.tabs[0].name).toBeUndefined()
    expect(computeTabLabels(state.tabs)).toEqual(['project'])
  })

  it('renameTab is a no-op for unknown ids and unchanged names', () => {
    const make = counter()
    const state = initTabs('/a', make)
    const renamed = renameTab(state, state.tabs[0].id, 'build')

    expect(renameTab(state, 'nope', 'x')).toBe(state)
    expect(renameTab(renamed, renamed.tabs[0].id, 'build')).toBe(renamed)
  })

  it('renameTab caps a stored custom name at MAX_TAB_NAME_LENGTH characters', () => {
    const make = counter()
    const state = initTabs('/a', make)
    const long = 'x'.repeat(MAX_TAB_NAME_LENGTH + 50)
    const renamed = renameTab(state, state.tabs[0].id, long)

    expect(renamed.tabs[0].name).toBe('x'.repeat(MAX_TAB_NAME_LENGTH))
    expect(renamed.tabs[0].name).toHaveLength(MAX_TAB_NAME_LENGTH)
  })

  it('renameTab trims before capping, so surrounding whitespace does not steal from the cap', () => {
    const make = counter()
    const state = initTabs('/a', make)
    const padded = `  ${'y'.repeat(MAX_TAB_NAME_LENGTH)}  `
    const renamed = renameTab(state, state.tabs[0].id, padded)

    expect(renamed.tabs[0].name).toBe('y'.repeat(MAX_TAB_NAME_LENGTH))
  })

  it('renameTab is still a no-op (same ref) when the name is unchanged after capping', () => {
    const make = counter()
    const state = initTabs('/a', make)
    const long = 'z'.repeat(MAX_TAB_NAME_LENGTH + 50)
    const renamed = renameTab(state, state.tabs[0].id, long)

    // Renaming again with a different over-cap string that caps to the same
    // stored value must be treated as unchanged (same ref), same as the
    // existing exact-match no-op case above.
    const again = renameTab(renamed, renamed.tabs[0].id, `${'z'.repeat(MAX_TAB_NAME_LENGTH)}extra-tail-that-gets-cut`)

    expect(again).toBe(renamed)
  })

  it('renameTab still clears back to the auto label when blank, even after a capped name', () => {
    const make = counter()
    const state = initTabs('/a/project', make)
    const long = renameTab(state, state.tabs[0].id, 'w'.repeat(MAX_TAB_NAME_LENGTH + 50))
    const cleared = renameTab(long, long.tabs[0].id, '   ')

    expect(cleared.tabs[0].name).toBeUndefined()
    expect(computeTabLabels(cleared.tabs)).toEqual(['project'])
  })

  it('custom names do not join the duplicate-count pool', () => {
    const make = counter()
    let state = initTabs('/x/project', make)
    state = openTab(state, '/y/project', make)
    state = openTab(state, '/z/project', make)
    state = renameTab(state, state.tabs[1].id, 'project')

    // Middle tab is custom "project"; the two autos still number 1..2.
    expect(computeTabLabels(state.tabs)).toEqual(['project', 'project', 'project 2'])
  })

  it('canOpenTab and openTab honor a custom max override', () => {
    const make = counter()
    let state = initTabs('/a', make)
    state = openTab(state, '/b', make) // 2 tabs, well under the default cap

    expect(canOpenTab(state, 2)).toBe(false)
    expect(openTab(state, '/c', make, 2)).toBe(state)
    expect(canOpenTab(state, 3)).toBe(true)
    expect(openTab(state, '/c', make, 3).tabs).toHaveLength(3)
  })
})
