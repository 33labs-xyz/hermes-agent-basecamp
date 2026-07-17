import { describe, expect, it } from 'vitest'

import type { ChatGroup } from '@/hermes'

import { groupedSessionIdSet } from './session-grouping'

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
