import { beforeEach, describe, expect, it } from 'vitest'

import { $groupKind, forgetGroupKind, groupKindOf, markGroupKind } from './group-kind'

const KEY = 'hermes.desktop.groupKind'

beforeEach(() => {
  localStorage.clear()
  $groupKind.set({})
})

describe('groupKindOf', () => {
  it('defaults an unknown id to project so legacy buckets stay projects', () => {
    expect(groupKindOf('never-seen')).toBe('project')
  })

  it('returns group only for an id explicitly marked group', () => {
    markGroupKind('a', 'group')
    expect(groupKindOf('a')).toBe('group')
  })

  it('treats a garbage stored value as project', () => {
    $groupKind.set({ a: 'banana' })
    expect(groupKindOf('a')).toBe('project')
  })
})

describe('markGroupKind', () => {
  it('adds the marker immutably (new object reference)', () => {
    const before = $groupKind.get()
    markGroupKind('a', 'group')
    expect($groupKind.get()).not.toBe(before)
    expect($groupKind.get()).toEqual({ a: 'group' })
  })

  it('persists to localStorage so the split survives reload', () => {
    markGroupKind('a', 'group')
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ a: 'group' })
  })
})

describe('forgetGroupKind', () => {
  it('removes the marker so the id falls back to project', () => {
    markGroupKind('a', 'group')
    forgetGroupKind('a')
    expect(groupKindOf('a')).toBe('project')
    expect($groupKind.get()).toEqual({})
  })

  it('is a no-op (same reference) for an id that was never marked', () => {
    markGroupKind('a', 'group')
    const before = $groupKind.get()
    forgetGroupKind('zzz')
    expect($groupKind.get()).toBe(before)
  })
})
