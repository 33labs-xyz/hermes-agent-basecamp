import type { SessionInfo } from '@/hermes'

const PREVIEW_FALLBACK_MAX = 60

// Resolve a project member chat's display title from whatever we know about it:
// a session loaded in a list, then metadata fetched by id, then its message
// preview, and finally a localized "untitled" label. Never falls back to a raw
// id slice — that surfaced as a bare date (the id prefix) in the UI.
export function projectMemberTitle(
  loaded: SessionInfo | undefined,
  cached: null | SessionInfo | undefined,
  untitledLabel: string
): string {
  const title = loaded?.title?.trim() || cached?.title?.trim()

  if (title) {
    return title
  }

  const preview = (loaded?.preview ?? cached?.preview)?.trim()

  if (preview) {
    return preview.length > PREVIEW_FALLBACK_MAX
      ? `${preview.slice(0, PREVIEW_FALLBACK_MAX - 1)}…`
      : preview
  }

  return untitledLabel
}
