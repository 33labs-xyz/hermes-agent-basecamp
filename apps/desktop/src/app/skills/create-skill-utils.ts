// Pure helpers for the Create Skill wizard. Slugging + validation mirror the
// backend's name rules (^[a-z0-9][a-z0-9._-]*$, max 64) so the UI can gate the
// Create button before the round trip; the backend stays authoritative.

const SLUG_MAX = 64
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/

export function slugifySkillName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-') // whitespace runs -> single hyphen
    .replace(/[^a-z0-9._-]/g, '') // drop anything outside the allowed set
    .replace(/-{2,}/g, '-') // collapse repeated hyphens (keep . and _ runs as typed)
    .replace(/^[-.]+|[-.]+$/g, '') // trim leading/trailing hyphens and dots
    .slice(0, SLUG_MAX)
}

export function isValidSkillSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= SLUG_MAX && SLUG_RE.test(slug)
}

export function buildSkillMarkdown(fields: { description: string; instructions: string; slug: string }): string {
  const description = fields.description.trim()
  const instructions = fields.instructions.trim()
  return `---\nname: ${fields.slug}\ndescription: ${description}\n---\n\n${instructions}`
}

// The Electron api() layer rejects HTTP >= 400 with `Error("<status>: <body>")`.
// FastAPI bodies are `{"detail":"..."}`, so peel the status prefix and, if the
// remainder is that JSON envelope, return the human-readable detail.
export function friendlyCreateSkillError(err: unknown, fallback: string): string {
  if (!(err instanceof Error) || !err.message) {
    return fallback
  }

  const match = /^\d{3}:\s*([\s\S]*)$/.exec(err.message)
  const remainder = match ? match[1].trim() : err.message

  try {
    const parsed = JSON.parse(remainder) as { detail?: unknown }
    if (parsed && typeof parsed.detail === 'string' && parsed.detail.trim()) {
      return parsed.detail.trim()
    }
  } catch {
    // Not JSON; fall through to the raw remainder.
  }

  return remainder || fallback
}
