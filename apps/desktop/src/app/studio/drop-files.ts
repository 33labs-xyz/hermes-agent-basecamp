// Pure helpers for dragging an image into the Studio workspace: parsing the
// internal file-tree drag payload, merging it with real OS-dropped files,
// filtering to images, and turning a data URL (from
// window.hermesDesktop.readFileDataUrl) into a File the vendored Studio
// components can upload. No DOM/IPC calls here, so all of this stays unit-
// testable in isolation - the host (index.tsx) owns the async IPC reads.

// Re-declared locally rather than imported - matches the existing convention
// elsewhere in the app (chat composer, terminal session) where this MIME
// constant is duplicated per feature instead of shared cross-feature.
export const HERMES_PATHS_MIME = 'application/x-hermes-paths'

export interface HermesDragPath {
  path: string
  isDirectory: boolean
}

export interface CollectedDrop {
  osFiles: File[]
  paths: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// Defensive parse of the internal file-tree drag payload (see
// right-sidebar/files/tree.tsx's onDragStart). Any malformed input - bad
// JSON, a non-array, or entries with the wrong shape - yields [] rather than
// throwing.
export function parseHermesPaths(raw: string | null | undefined): HermesDragPath[] {
  if (!raw) {return []}

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) {return []}

  const entries: HermesDragPath[] = []

  for (const item of parsed) {
    if (isRecord(item) && typeof item.path === 'string') {
      entries.push({ path: item.path, isDirectory: item.isDirectory === true })
    }
  }

  return entries
}

// Merges the two sources a Studio drop can carry: real OS files (Finder /
// Explorer) and internal file-tree paths (folders filtered out - a directory
// has nothing to upload). Guards dataTransfer.getData throwing, which some
// platforms do outside a real drop event.
export function collectDrop(dataTransfer: DataTransfer): CollectedDrop {
  const osFiles = Array.from(dataTransfer.files ?? [])

  let raw: string | null = null

  try {
    raw = dataTransfer.getData(HERMES_PATHS_MIME)
  } catch {
    raw = null
  }

  const paths = parseHermesPaths(raw)
    .filter(entry => !entry.isDirectory)
    .map(entry => entry.path)

  return { osFiles, paths }
}

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i

export function isImageFile(nameOrType: { name?: string; type?: string }): boolean {
  if (nameOrType.type?.startsWith('image/')) {return true}

  return Boolean(nameOrType.name && IMAGE_EXTENSION_PATTERN.test(nameOrType.name))
}

export function filterImageFiles(files: File[]): File[] {
  return files.filter(file => isImageFile(file))
}

// Requires the `;base64,` marker (mime may be empty) - matches what
// window.hermesDesktop.readFileDataUrl / FileReader.readAsDataURL produce.
const DATA_URL_PATTERN = /^data:([^;,]*);base64,(.*)$/s

// Decodes a data: URL directly via atob (no fetch, so this stays unit-
// testable in Node/jsdom) into a File. Returns null when the string isn't a
// parseable base64 data URL.
export function dataUrlToFile(dataUrl: string, filename: string): File | null {
  const match = DATA_URL_PATTERN.exec(dataUrl)

  if (!match) {return null}

  const [, mime, base64] = match

  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)

    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }

    return new File([bytes], filename, { type: mime || '' })
  } catch {
    return null
  }
}

export function basename(path: string): string {
  const segments = path.split(/[/\\]/).filter(Boolean)

  return segments.at(-1) ?? path
}
