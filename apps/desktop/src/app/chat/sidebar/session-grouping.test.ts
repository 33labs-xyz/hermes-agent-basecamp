import { describe, expect, it } from 'vitest'

import type { ChatGroup } from '@/hermes'

import { excludeGrouped, groupedSessionIdSet, partitionGroups } from './session-grouping'

const bucket = (over: Partial<ChatGroup> = {}): ChatGroup => ({
  created_at: 0,
  description: '',
  id: 'b1',
  instructions: '',
  name: 'B',
  position: 0,
  session_ids: [],
  updated_at: 0,
  ...over
})

describe('groupedSessionIdSet', () => {
  it('collects session ids across every bucket', () => {
    const set = groupedSessionIdSet([
      bucket({ id: 'b1', session_ids: ['s1', 's2'] }),
      bucket({ id: 'b2', session_ids: ['s3'] })
    ])
    expect(set).toEqual(new Set(['s1', 's2', 's3']))
  })

  it('is empty for no buckets', () => {
    expect(groupedSessionIdSet([]).size).toBe(0)
  })
})

describe('excludeGrouped', () => {
  it('removes sessions that live in a bucket', () => {
    const sessions = [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
    expect(excludeGrouped(sessions, new Set(['s2']))).toEqual([{ id: 's1' }, { id: 's3' }])
  })

  it('returns the same array reference when nothing is grouped (no render churn)', () => {
    const sessions = [{ id: 's1' }]
    expect(excludeGrouped(sessions, new Set<string>())).toBe(sessions)
  })
})

describe('partitionGroups', () => {
  it('routes group-marked buckets to groups, everything else to projects, order preserved', () => {
    const buckets = [
      bucket({ id: 'p1' }),
      bucket({ id: 'g1' }),
      bucket({ id: 'p2' }),
      bucket({ id: 'g2' })
    ]
    const { groups, projects } = partitionGroups(buckets, { g1: 'group', g2: 'group' })
    expect(projects.map(b => b.id)).toEqual(['p1', 'p2'])
    expect(groups.map(b => b.id)).toEqual(['g1', 'g2'])
  })

  it('defaults unmarked and garbage-marked buckets to projects', () => {
    const buckets = [bucket({ id: 'p1' }), bucket({ id: 'x1' })]
    const { groups, projects } = partitionGroups(buckets, { x1: 'banana' })
    expect(projects.map(b => b.id)).toEqual(['p1', 'x1'])
    expect(groups).toEqual([])
  })
})
