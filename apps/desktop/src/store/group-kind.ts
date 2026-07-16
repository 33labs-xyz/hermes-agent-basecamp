import { atom } from 'nanostores'

import { persistStringRecord, storedStringRecord } from '@/lib/storage'

export type GroupKind = 'group' | 'project'

const GROUP_KIND_STORAGE_KEY = 'hermes.desktop.groupKind'

// Client-side marker that splits the single chat_groups backend into two sidebar
// concepts. A bucket is a lightweight "group" ONLY if explicitly stamped here;
// everything else (including every pre-existing bucket) defaults to "project",
// so no backfill is needed and the backend stays untouched + upstream-mergeable.
export const $groupKind = atom<Record<string, string>>(storedStringRecord(GROUP_KIND_STORAGE_KEY))

$groupKind.subscribe(map => persistStringRecord(GROUP_KIND_STORAGE_KEY, map))

export function groupKindOf(id: string): GroupKind {
  return $groupKind.get()[id] === 'group' ? 'group' : 'project'
}

export function markGroupKind(id: string, kind: GroupKind): void {
  $groupKind.set({ ...$groupKind.get(), [id]: kind })
}

export function forgetGroupKind(id: string): void {
  const current = $groupKind.get()

  if (!(id in current)) {
    return
  }

  const next = { ...current }
  delete next[id]
  $groupKind.set(next)
}
