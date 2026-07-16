import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatGroup } from '@/hermes'

const assignConversation = vi.fn(async (..._args: unknown[]) => undefined)
const unassignConversation = vi.fn(async (..._args: unknown[]) => undefined)
const listChatGroups = vi.fn(async (): Promise<ChatGroup[]> => [])
const createChatGroup = vi.fn(async (..._args: unknown[]) => undefined as unknown)
const deleteChatGroup = vi.fn(async (..._args: unknown[]) => undefined)
const updateChatGroup = vi.fn(async (..._args: unknown[]) => undefined as unknown)

const markGroupKind = vi.fn()
const forgetGroupKind = vi.fn()

vi.mock('@/hermes', () => ({
  assignConversation: (...a: unknown[]) => assignConversation(...a),
  createChatGroup: (...a: unknown[]) => createChatGroup(...a),
  deleteChatGroup: (...a: unknown[]) => deleteChatGroup(...a),
  getSession: vi.fn(),
  listChatGroups: () => listChatGroups(),
  unassignConversation: (...a: unknown[]) => unassignConversation(...a),
  updateChatGroup: (...a: unknown[]) => updateChatGroup(...a)
}))
vi.mock('@/lib/storage', () => ({
  persistBoolean: vi.fn(),
  storedBoolean: (_key: string, fallback: boolean) => fallback
}))
vi.mock('@/store/group-kind', () => ({
  forgetGroupKind: (...a: unknown[]) => forgetGroupKind(...a),
  groupKindOf: () => 'project',
  markGroupKind: (...a: unknown[]) => markGroupKind(...a)
}))

const {
  $pendingProjectGroupId,
  $pendingProjectHandoffSend,
  $projects,
  $sidebarGroupsOpen,
  addOptimisticMembership,
  clearPendingProjectAssignment,
  consumePendingProjectAssignment,
  createGroup,
  deleteProject,
  reorderProjects,
  setPendingProjectForNewChat,
  setProjectHandoffSend,
  setSidebarGroupsOpen,
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
  createChatGroup.mockClear().mockResolvedValue(group())
  deleteChatGroup.mockClear().mockResolvedValue(undefined)
  updateChatGroup.mockClear().mockResolvedValue(undefined)
  markGroupKind.mockClear()
  forgetGroupKind.mockClear()
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

describe('createGroup', () => {
  it('creates a name-only bucket, stamps it as a group, and refreshes', async () => {
    const created = group({ id: 'grp-new', name: 'Reading' })
    createChatGroup.mockResolvedValue(created)
    listChatGroups.mockResolvedValue([created])

    const result = await createGroup('Reading')

    expect(createChatGroup).toHaveBeenCalledWith({ name: 'Reading' })
    expect(markGroupKind).toHaveBeenCalledWith('grp-new', 'group')
    expect(result).toBe(created)
    expect($projects.get()).toEqual([created])
  })
})

describe('deleteProject forgets the kind marker', () => {
  it('drops the client-side marker so a future bucket reusing the id is not mis-typed', async () => {
    await deleteProject('grp-1')

    expect(deleteChatGroup).toHaveBeenCalledWith('grp-1')
    expect(forgetGroupKind).toHaveBeenCalledWith('grp-1')
  })
})

describe('setSidebarGroupsOpen', () => {
  it('toggles the groups-section open atom', () => {
    setSidebarGroupsOpen(false)
    expect($sidebarGroupsOpen.get()).toBe(false)
    setSidebarGroupsOpen(true)
    expect($sidebarGroupsOpen.get()).toBe(true)
  })
})

describe('reorderProjects with a subset', () => {
  it('reindexes only the passed ids and leaves other buckets in place', async () => {
    const p1 = group({ id: 'p1', name: 'P1', position: 0 })
    const p2 = group({ id: 'p2', name: 'P2', position: 1 })
    const g1 = group({ id: 'g1', name: 'G1', position: 2 })
    $projects.set([p1, p2, g1])

    // Reorder just the projects subset to [p2, p1]; g1 (a group) must stay last.
    await reorderProjects(['p2', 'p1'])

    expect($projects.get().map(b => b.id)).toEqual(['p2', 'p1', 'g1'])
    expect($projects.get().map(b => b.position)).toEqual([0, 1, 2])
    // p2 and p1 changed index, so both are persisted; g1 stays at index 2 (unchanged).
    expect(updateChatGroup).toHaveBeenCalledWith('p2', { position: 0 })
    expect(updateChatGroup).toHaveBeenCalledWith('p1', { position: 1 })
    expect(updateChatGroup).not.toHaveBeenCalledWith('g1', { position: 2 })
  })

  it('early-returns without writes when an id is unknown', async () => {
    $projects.set([group({ id: 'p1', position: 0 })])

    await reorderProjects(['p1', 'ghost'])

    expect(updateChatGroup).not.toHaveBeenCalled()
    expect($projects.get().map(b => b.id)).toEqual(['p1'])
  })
})
