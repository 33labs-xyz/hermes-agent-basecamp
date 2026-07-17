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
