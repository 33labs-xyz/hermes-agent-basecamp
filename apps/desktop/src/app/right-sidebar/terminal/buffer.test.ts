import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearActiveTerminalReader,
  readActiveTerminal,
  setActiveTerminalReader,
  type TerminalReadResult
} from './buffer'

// A reader tagged by total_lines so we can tell which one owns the slot.
const tagged = (id: number) => (): TerminalReadResult => ({
  total_lines: id,
  start: 0,
  end: 0,
  viewport_rows: 0,
  cursor_row: 0,
  text: ''
})

describe('active terminal reader slot', () => {
  beforeEach(() => {
    setActiveTerminalReader(null)
  })

  it('reads through whichever reader is currently set', () => {
    setActiveTerminalReader(tagged(1))

    expect(readActiveTerminal()?.total_lines).toBe(1)
  })

  it('clear does NOT null the slot when the passed reader is no longer active', () => {
    const a = tagged(1)
    const b = tagged(2)
    setActiveTerminalReader(a)
    setActiveTerminalReader(b)

    clearActiveTerminalReader(a) // a's stale cleanup must not evict b

    expect(readActiveTerminal()?.total_lines).toBe(2)
  })

  it('clear nulls the slot when the active reader releases itself', () => {
    const b = tagged(2)
    setActiveTerminalReader(b)

    clearActiveTerminalReader(b)

    expect(readActiveTerminal()).toBeNull()
  })

  it('clear(null) is a safe no-op', () => {
    setActiveTerminalReader(tagged(1))

    clearActiveTerminalReader(null)

    expect(readActiveTerminal()?.total_lines).toBe(1)
  })
})
