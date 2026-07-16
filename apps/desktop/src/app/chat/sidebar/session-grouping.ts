import type { ChatGroup } from '@/hermes'

// Every session id that lives inside ANY bucket. The sidebar subtracts these
// from the flat recents list so a filed chat shows only under its bucket.
export function groupedSessionIdSet(buckets: ChatGroup[]): Set<string> {
  const ids = new Set<string>()

  for (const bucket of buckets) {
    for (const sessionId of bucket.session_ids) {
      ids.add(sessionId)
    }
  }

  return ids
}

// Split buckets into the two sidebar sections by their client-side kind marker.
// Same rule as groupKindOf: only an explicit 'group' marker routes to groups;
// unmarked and garbage values fall through to projects. Input order (backend
// position sort) is preserved within each section.
export function partitionGroups(
  buckets: ChatGroup[],
  kindMap: Record<string, string>
): { groups: ChatGroup[]; projects: ChatGroup[] } {
  const groups: ChatGroup[] = []
  const projects: ChatGroup[] = []

  for (const bucket of buckets) {
    if (kindMap[bucket.id] === 'group') {
      groups.push(bucket)
    } else {
      projects.push(bucket)
    }
  }

  return { groups, projects }
}
