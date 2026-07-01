import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatGroup } from '@/hermes'

const assignConversation = vi.fn(async (..._args: unknown[]) => undefined)
const unassignConversation = vi.fn(async (..._args: unknown[]) => undefined)
const listChatGroups = vi.fn(async (): Promise<ChatGroup[]> => [])

vi.mock('@/hermes', () => ({
  assignConversation: (...a: unknown[]) => assignConversation(...a),
  createChatGroup: vi.fn(),
  deleteChatGroup: vi.fn(),
  getSession: vi.fn(),
  listChatGroups: () => listChatGroups(),
  unassignConversation: (...a: unknown[]) => unassignConversation(...a),
  updateChatGroup: vi.fn()
}))
vi.mock('@/lib/storage', () => ({
  persistBoolean: vi.fn(),
  storedBoolean: (_key: string, fallback: boolean) => fallback
}))

const {
  $pendingProjectGroupId,
  $pendingProjectHandoffSend,
  $projects,
  addOptimisticMembership,
  clearPendingProjectAssignment,
  consumePendingProjectAssignment,
  setPendingProjectForNewChat,
  setProjectHandoffSend,
  takeProjectHandoffSend
} = await import('./projects')

const group = (over: Partial<ChatGroup> = {}): ChatGroup => ({
  created_at: 0,
  description: '',
  id: 'grp-1',
  instructions: '',
  name: 'Marketing',
  position: 0,
  session_ids: [],
  updated_at: 0,
  ...over
})

beforeEach(() => {
  $projects.set([])
  $pendingProjectGroupId.set(null)
  $pendingProjectHandoffSend.set(false)
  assignConversation.mockClear().mockResolvedValue(undefined)
  listChatGroups.mockClear().mockResolvedValue([])
})

describe('project handoff auto-send arm', () => {
  it('take returns true once then false (idempotent one-shot)', () => {
    setProjectHandoffSend(true)

    expect(takeProjectHandoffSend()).toBe(true)
    expect(takeProjectHandoffSend()).toBe(false)
  })

  it('take returns false when never armed', () => {
    expect(takeProjectHandoffSend()).toBe(false)
  })
})

describe('addOptimisticMembership', () => {
  it('adds the session to the matching group immutably, without duplicates', () => {
    const before = group({ session_ids: ['a'] })
    $projects.set([before])

    addOptimisticMembership('grp-1', 'sess-new')

    const after = $projects.get()[0]
    expect(after.session_ids).toEqual(['a', 'sess-new'])
    expect(after).not.toBe(before)

    addOptimisticMembership('grp-1', 'sess-new')
    expect($projects.get()[0].session_ids).toEqual(['a', 'sess-new'])
  })

  it('leaves non-matching groups untouched', () => {
    $projects.set([group({ id: 'grp-2', session_ids: ['x'] })])

    addOptimisticMembership('grp-1', 'sess-new')

    expect($projects.get()[0].session_ids).toEqual(['x'])
  })
})

describe('consumePendingProjectAssignment', () => {
  it('shows membership optimistically before the network settles, then reconciles', async () => {
    $projects.set([group({ session_ids: [] })])
    setPendingProjectForNewChat('grp-1')
    setProjectHandoffSend(true)
    listChatGroups.mockResolvedValue([group({ session_ids: ['sess-1'] })])

    const pending = consumePendingProjectAssignment('sess-1')

    // Synchronous optimistic add: the pill can resolve on the first frame.
    expect($projects.get()[0].session_ids).toContain('sess-1')
    // Arm + auto-send flag cleared immediately so nothing leaks onto later chats.
    expect($pendingProjectGroupId.get()).toBeNull()
    expect($pendingProjectHandoffSend.get()).toBe(false)

    await pending

    expect(assignConversation).toHaveBeenCalledWith('grp-1', 'sess-1')
    expect($projects.get()[0].session_ids).toEqual(['sess-1'])
  })

  it('rolls back the optimistic membership when the assign fails', async () => {
    $projects.set([group({ session_ids: [] })])
    setPendingProjectForNewChat('grp-1')
    assignConversation.mockRejectedValue(new Error('assign failed'))

    await consumePendingProjectAssignment('sess-1')

    expect($projects.get()[0].session_ids).not.toContain('sess-1')
  })

  it('no-ops when no project is armed', async () => {
    $projects.set([group({ session_ids: [] })])

    await consumePendingProjectAssignment('sess-1')

    expect(assignConversation).not.toHaveBeenCalled()
    expect($projects.get()[0].session_ids).toEqual([])
  })
})

describe('clearPendingProjectAssignment', () => {
  it('clears both the group arm and the auto-send flag', () => {
    setPendingProjectForNewChat('grp-1')
    setProjectHandoffSend(true)

    clearPendingProjectAssignment()

    expect($pendingProjectGroupId.get()).toBeNull()
    expect($pendingProjectHandoffSend.get()).toBe(false)
  })
})
