import { describe, expect, it } from 'vitest'

import {
  parseOpenRouterKeyRemaining,
  pickDisplayedProvider,
  resolveDefaultProvider,
  sortBalanceRows,
  type BalanceRow
} from './provider-balances'

function row(slug: string, status: BalanceRow['status'], balance: number | null = null): BalanceRow {
  return { slug, label: slug, status, balance }
}

describe('resolveDefaultProvider', () => {
  it('prefers OpenRouter when ok', () => {
    const rows = [row('muapi', 'ok', 10), row('openrouter', 'ok', 5)]
    expect(resolveDefaultProvider(rows)).toBe('openrouter')
  })

  it('falls back to MUAPI when OpenRouter is not ok', () => {
    const rows = [row('openrouter', 'unavailable'), row('muapi', 'ok', 10)]
    expect(resolveDefaultProvider(rows)).toBe('muapi')
  })

  it('falls back to the first ok row when neither OpenRouter nor MUAPI is ok', () => {
    const rows = [row('openrouter', 'unavailable'), row('groq', 'ok', 3), row('muapi', 'unsupported')]
    expect(resolveDefaultProvider(rows)).toBe('groq')
  })

  it('returns null when no row is ok even if unavailable/unsupported rows exist', () => {
    const rows = [row('openrouter', 'unavailable'), row('anthropic', 'unsupported')]
    expect(resolveDefaultProvider(rows)).toBeNull()
  })

  it('returns null for non-array input', () => {
    expect(resolveDefaultProvider(null)).toBeNull()
    expect(resolveDefaultProvider(undefined)).toBeNull()
  })
})

describe('sortBalanceRows', () => {
  it('orders ok before unavailable before unsupported', () => {
    const rows = [row('a', 'unsupported'), row('b', 'ok'), row('c', 'unavailable')]
    expect(sortBalanceRows(rows).map(r => r.slug)).toEqual(['b', 'c', 'a'])
  })

  it('is stable within a status group', () => {
    const rows = [row('a', 'ok'), row('b', 'ok'), row('c', 'ok')]
    expect(sortBalanceRows(rows).map(r => r.slug)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input', () => {
    const rows = [row('a', 'unsupported'), row('b', 'ok')]
    const snapshot = rows.map(r => r.slug)
    sortBalanceRows(rows)
    expect(rows.map(r => r.slug)).toEqual(snapshot)
  })

  it('returns an empty array for non-array input', () => {
    expect(sortBalanceRows(null)).toEqual([])
  })
})

describe('pickDisplayedProvider', () => {
  const okSet = (oks: string[]) => (slug: string) => oks.includes(slug)

  it('pins MUAPI on Studio when MUAPI is ok', () => {
    const got = pickDisplayedProvider({ isStudio: true, selected: 'openrouter', fallback: 'openrouter', isOk: okSet(['openrouter', 'muapi']) })
    expect(got).toBe('muapi')
  })

  it('falls through to fallback on Studio when MUAPI is not ok', () => {
    const got = pickDisplayedProvider({ isStudio: true, selected: null, fallback: 'openrouter', isOk: okSet(['openrouter']) })
    expect(got).toBe('openrouter')
  })

  it('returns the selected pick when it is ok and not Studio', () => {
    const got = pickDisplayedProvider({ isStudio: false, selected: 'groq', fallback: 'openrouter', isOk: okSet(['groq', 'openrouter']) })
    expect(got).toBe('groq')
  })

  it('ignores a stale non-ok pin in favor of fallback', () => {
    const got = pickDisplayedProvider({ isStudio: false, selected: 'groq', fallback: 'openrouter', isOk: okSet(['openrouter']) })
    expect(got).toBe('openrouter')
  })
})

describe('parseOpenRouterKeyRemaining', () => {
  it('returns limit_remaining when finite', () => {
    expect(parseOpenRouterKeyRemaining({ data: { limit_remaining: 74.5 } })).toBe(74.5)
  })

  it('returns null when limit_remaining is null (unlimited key)', () => {
    expect(parseOpenRouterKeyRemaining({ data: { limit_remaining: null } })).toBeNull()
  })

  it('returns null when the field or data is missing or non-finite', () => {
    expect(parseOpenRouterKeyRemaining({ data: {} })).toBeNull()
    expect(parseOpenRouterKeyRemaining({})).toBeNull()
    expect(parseOpenRouterKeyRemaining(null)).toBeNull()
    expect(parseOpenRouterKeyRemaining({ data: { limit_remaining: Infinity } })).toBeNull()
  })
})
