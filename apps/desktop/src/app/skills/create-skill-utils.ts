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

// A skill file (SKILL.md, or any .md/.txt) parsed into the wizard's fields. The
// name/description come from YAML frontmatter when present; everything after the
// frontmatter (or the whole file, if there is none) becomes the instructions.
export interface ImportedSkill {
  name?: string
  description?: string
  instructions: string
}

// Opening frontmatter: a lone `---` on the first line, its keys, then a closing
// `---` line. Lazy body match so the FIRST closing fence wins.
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/

// Peel surrounding matching single or double quotes from a scalar value.
function stripQuotes(value: string): string {
  const first = value[0]

  if (value.length >= 2 && (first === '"' || first === "'") && value[value.length - 1] === first) {
    return value.slice(1, -1)
  }

  return value
}

// Read one top-level `key: value` line out of a frontmatter block. Deliberately
// shallow: single-line scalars only, which is all a SKILL.md name/description is.
function readFrontmatterValue(frontmatter: string, key: string): string | undefined {
  const line = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(frontmatter)

  if (!line) {
    return undefined
  }

  const value = stripQuotes(line[1].trim())

  return value.length > 0 ? value : undefined
}

// Parse an imported markdown/text file into wizard fields. Frontmatter name and
// description are lifted into their fields (so the live preview reconstructs a
// clean SKILL.md); the body fills instructions. Files without frontmatter drop
// wholesale into instructions. Extra frontmatter keys are ignored, matching what
// the single-file create path can produce.
export function parseImportedSkill(text: string): ImportedSkill {
  const normalized = text.replace(/\r\n?/g, '\n')
  const match = FRONTMATTER_RE.exec(normalized)

  if (!match) {
    return { instructions: normalized.trim() }
  }

  return {
    name: readFrontmatterValue(match[1], 'name'),
    description: readFrontmatterValue(match[1], 'description'),
    instructions: normalized.slice(match[0].length).trim()
  }
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
