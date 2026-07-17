// A phone photo's base64 payload runs 4-11MB, and the composer hands those raw
// `data:` URLs straight to the renderer (see optimisticAttachmentRef). A regex
// quantifier walking a payload that size overflows V8's backtrack stack - it
// pushes a frame per repetition - throwing "Maximum call stack size exceeded"
// in ~13ms. Lazy quantifiers and bounded rewrites overflow too, so the payload
// is never matched: only the fixed-size prefix and suffix stay in regexes, and
// the payload's end is found by scanning for the first non-base64 character.
const EMBEDDED_IMAGE_PREFIX_RE =
  /(\{\s*"type"\s*:\s*"image_url"\s*,\s*"image_url"\s*:\s*\{\s*"url"\s*:\s*")?(data:image\/[\w.+-]+;base64,)/g

const EMBEDDED_IMAGE_SUFFIX_RE = /"\s*\}\s*\}/y

const NON_BASE64_RE = /[^A-Za-z0-9+/=]/g

const MIN_BASE64_LEN = 64

const DATA_URL_RE = /^data:([\w./+-]+);base64,(.*)$/i

export const DATA_IMAGE_URL_RE = /^data:image\/[\w.+-]+;base64,/i

export interface EmbeddedImageExtraction {
  cleanedText: string
  images: string[]
}

export function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = DATA_URL_RE.exec(dataUrl.trim())

  if (!match) {
    return null
  }

  try {
    const bytes = atob(match[2])
    const buffer = new Uint8Array(bytes.length)

    for (let i = 0; i < bytes.length; i += 1) {
      buffer[i] = bytes.charCodeAt(i)
    }

    return new Blob([buffer], { type: match[1] })
  } catch {
    return null
  }
}

function base64RunEnd(text: string, from: number): number {
  NON_BASE64_RE.lastIndex = from

  const match = NON_BASE64_RE.exec(text)

  return match ? match.index : text.length
}

export function extractEmbeddedImages(text: string): EmbeddedImageExtraction {
  if (!text || !text.includes('data:image/')) {
    return { cleanedText: text, images: [] }
  }

  const images: string[] = []
  const kept: string[] = []
  let cursor = 0

  EMBEDDED_IMAGE_PREFIX_RE.lastIndex = 0

  for (let match = EMBEDDED_IMAGE_PREFIX_RE.exec(text); match; match = EMBEDDED_IMAGE_PREFIX_RE.exec(text)) {
    const dataUrlStart = match.index + (match[1]?.length ?? 0)
    const payloadStart = match.index + match[0].length
    const payloadEnd = base64RunEnd(text, payloadStart)

    // Too short to be an image payload: leave it in the text, and resume the
    // search after the prefix we just rejected.
    if (payloadEnd - payloadStart < MIN_BASE64_LEN) {
      continue
    }

    EMBEDDED_IMAGE_SUFFIX_RE.lastIndex = payloadEnd

    const matchEnd = EMBEDDED_IMAGE_SUFFIX_RE.exec(text) ? EMBEDDED_IMAGE_SUFFIX_RE.lastIndex : payloadEnd

    kept.push(text.slice(cursor, match.index))
    images.push(text.slice(dataUrlStart, payloadEnd))

    cursor = matchEnd
    EMBEDDED_IMAGE_PREFIX_RE.lastIndex = matchEnd
  }

  kept.push(text.slice(cursor))

  const cleanedText = kept
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { cleanedText, images }
}

export function embeddedImageUrls(text: string): string[] {
  return extractEmbeddedImages(text).images
}

export function textWithoutEmbeddedImages(text: string): string {
  return extractEmbeddedImages(text).cleanedText
}
