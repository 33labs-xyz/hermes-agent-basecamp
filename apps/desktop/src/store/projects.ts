import { atom } from 'nanostores'

import {
  assignConversation,
  type ChatGroup,
  createChatGroup,
  deleteChatGroup,
  getSession,
  listChatGroups,
  type SessionInfo,
  unassignConversation,
  updateChatGroup
} from '@/hermes'
import { persistBoolean, storedBoolean } from '@/lib/storage'

const SIDEBAR_PROJECTS_OPEN_STORAGE_KEY = 'hermes.desktop.sidebarProjectsOpen'

// Projects (chat groups) bundle related conversations and can carry shared
// instructions that steer every chat inside them — the desktop mirror of the
// dashboard's conversation-library groups. Loaded on connect and kept fresh by
// the sidebar section + after each mutation, mirroring how $cronJobs works.
export const $projects = atom<ChatGroup[]>([])
export const $projectsLoading = atom(false)
// Expanded by default: the section only renders when projects exist, so an open
// default surfaces them without an extra click.
export const $sidebarProjectsOpen = atom(storedBoolean(SIDEBAR_PROJECTS_OPEN_STORAGE_KEY, true))

$sidebarProjectsOpen.subscribe(open => persistBoolean(SIDEBAR_PROJECTS_OPEN_STORAGE_KEY, open))

export function setSidebarProjectsOpen(open: boolean) {
  $sidebarProjectsOpen.set(open)
}

// "New chat in this project" arms a one-shot assignment: the project page sets
// the group id, then opens a fresh chat draft. The next backend session created
// for a send consumes it (see consumePendingProjectAssignment) so the new chat
// lands in the project without the page re-implementing the whole send flow.
export const $pendingProjectGroupId = atom<string | null>(null)

// Companion one-shot: the launchpad composer already stashes the typed draft for
// the fresh chat to prefill; this tells that chat to also SEND it on arrival, so
// the user's Enter in the project actually sends instead of parking a prefilled
// draft in a blank chat (the "leads me outside to a normal chat box" bug). The
// blank "New chat" button leaves this false — it should open an empty chat.
export const $pendingProjectHandoffSend = atom(false)

export function setPendingProjectForNewChat(groupId: string | null) {
  $pendingProjectGroupId.set(groupId)
}

export function setProjectHandoffSend(next: boolean) {
  $pendingProjectHandoffSend.set(next)
}

// Read-and-clear the auto-send flag. Synchronous get/set makes it atomic, so a
// double effect invocation (e.g. React StrictMode) can't send the draft twice.
export function takeProjectHandoffSend(): boolean {
  const armed = $pendingProjectHandoffSend.get()

  if (armed) {
    $pendingProjectHandoffSend.set(false)
  }

  return armed
}

// Drop the whole handoff arm without assigning — used when a send produced no
// stored session id, so a later unrelated chat can't inherit this project.
export function clearPendingProjectAssignment() {
  $pendingProjectGroupId.set(null)
  $pendingProjectHandoffSend.set(false)
}

// Optimistically add a session to a group's members in the local store so the
// chat's project pill (resolved off session_ids) shows from the first frame,
// before the network assign + refresh lands. Immutable update mirroring
// reorderProjects; a no-op if the member is already present.
export function addOptimisticMembership(groupId: string, sessionId: string) {
  $projects.set(
    $projects.get().map(group =>
      group.id === groupId && !group.session_ids.includes(sessionId)
        ? { ...group, session_ids: [...group.session_ids, sessionId] }
        : group
    )
  )
}

function removeOptimisticMembership(groupId: string, sessionId: string) {
  $projects.set(
    $projects.get().map(group =>
      group.id === groupId
        ? { ...group, session_ids: group.session_ids.filter(id => id !== sessionId) }
        : group
    )
  )
}

// Called once a new session's stored id exists. If a project was armed, assign
// the chat to it and clear the arm. Optimistically shows membership so the pill
// is instant; rolls back if the network assign fails (the send already
// succeeded, so the chat is simply left ungrouped).
export async function consumePendingProjectAssignment(storedSessionId: string): Promise<void> {
  const groupId = $pendingProjectGroupId.get()

  if (!groupId) {
    return
  }

  $pendingProjectGroupId.set(null)
  $pendingProjectHandoffSend.set(false)

  addOptimisticMembership(groupId, storedSessionId)

  try {
    await addSessionToProject(groupId, storedSessionId)
  } catch {
    removeOptimisticMembership(groupId, storedSessionId)
  }
}

// Refresh the project list off the backend. Mutation helpers below await it so
// the sidebar reflects changes immediately (no stale list until the next poll).
export async function refreshProjects(): Promise<void> {
  $projectsLoading.set(true)

  try {
    $projects.set(await listChatGroups())
  } finally {
    $projectsLoading.set(false)
  }
}

// Backend group rows carry only `session_ids`, not titles. Project members that
// fall outside the loaded recent-sessions page would otherwise render as a raw
// id prefix (e.g. today's date "20260618"). This cache holds session metadata
// fetched by id so those rows show the real chat title. `null` marks a member
// that 404'd (e.g. deleted) so we don't refetch it every render.
export const $projectSessionMeta = atom<Record<string, null | SessionInfo>>({})

const inFlightSessionMeta = new Set<string>()

// Fetch + cache metadata for any member ids not already known (loaded in a
// session list) and not already cached or in-flight. Best-effort and fire-and-
// forget: each resolved fetch updates the cache, re-rendering subscribers.
export function ensureProjectMemberSessions(ids: string[], knownIds: Set<string>): void {
  const cache = $projectSessionMeta.get()
  const missing = ids.filter(
    id => !knownIds.has(id) && !(id in cache) && !inFlightSessionMeta.has(id)
  )

  if (missing.length === 0) {
    return
  }

  for (const id of missing) {
    inFlightSessionMeta.add(id)

    getSession(id)
      .then(info => {
        $projectSessionMeta.set({ ...$projectSessionMeta.get(), [id]: info })
      })
      .catch(() => {
        $projectSessionMeta.set({ ...$projectSessionMeta.get(), [id]: null })
      })
      .finally(() => {
        inFlightSessionMeta.delete(id)
      })
  }
}

export async function createProject(input: {
  description?: string
  instructions?: string
  name: string
}): Promise<ChatGroup> {
  const created = await createChatGroup(input)
  await refreshProjects()

  return created
}

export async function updateProject(
  id: string,
  updates: { description?: string; instructions?: string; name?: string }
): Promise<ChatGroup> {
  const updated = await updateChatGroup(id, updates)
  await refreshProjects()

  return updated
}

export async function deleteProject(id: string): Promise<void> {
  await deleteChatGroup(id)
  await refreshProjects()
}

// Persist a new project order from a sidebar drag. Reorder $projects optimistically
// (the drag should feel instant) then write each row's position to the backend.
// position = array index, so the list re-renders in the dragged order and the
// next refresh returns it in the same order. A failed persist refreshes back to
// the server's truth rather than leaving the UI lying.
export async function reorderProjects(orderedIds: string[]): Promise<void> {
  const current = $projects.get()
  const byId = new Map(current.map(project => [project.id, project]))
  const reordered = orderedIds.map(id => byId.get(id)).filter((p): p is ChatGroup => p !== undefined)

  if (reordered.length !== current.length) {
    return
  }

  $projects.set(reordered.map((project, index) => ({ ...project, position: index })))

  try {
    await Promise.all(
      reordered.map((project, index) =>
        project.position === index ? null : updateChatGroup(project.id, { position: index })
      )
    )
  } catch {
    await refreshProjects()
  }
}

export async function addSessionToProject(projectId: string, sessionId: string): Promise<void> {
  await assignConversation(projectId, sessionId)
  await refreshProjects()
}

export async function removeSessionFromProject(projectId: string, sessionId: string): Promise<void> {
  await unassignConversation(projectId, sessionId)
  await refreshProjects()
}
