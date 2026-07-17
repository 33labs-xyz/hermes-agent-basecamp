import { describe, expect, it } from 'vitest'

import { extractEmbeddedImages } from './embedded-images'

const SAMPLE_PNG_DATA_URL = 'data:image/png;base64,' + 'A'.repeat(120)

// A phone photo is 3-8MB, so its base64 `data:` URL runs 4-11MB. The composer
// hands those raw data URLs straight to DirectiveContent (see
// optimisticAttachmentRef), so the extractor has to survive one at full size.
const largeDataUrl = (megabytes: number) =>
  'data:image/jpeg;base64,' + 'ABCDefgh+/12'.repeat(Math.round((megabytes * 1024 * 1024) / 12))

describe('extractEmbeddedImages', () => {
  it('returns text untouched when no data URL is present', () => {
    expect(extractEmbeddedImages('describe this')).toEqual({ cleanedText: 'describe this', images: [] })
  })

  it('lifts a bare data:image URL out of prose', () => {
    const result = extractEmbeddedImages(`describe this ${SAMPLE_PNG_DATA_URL}`)

    expect(result.cleanedText).toBe('describe this')
    expect(result.images).toEqual([SAMPLE_PNG_DATA_URL])
  })

  it('lifts a JSON-wrapped image_url envelope out of prose', () => {
    const result = extractEmbeddedImages(
      `describe this{"type":"image_url","image_url":{"url":"${SAMPLE_PNG_DATA_URL}"}}`
    )

    expect(result.cleanedText).toBe('describe this')
    expect(result.images).toEqual([SAMPLE_PNG_DATA_URL])
  })

  it('extracts multiple embedded images', () => {
    const second = 'data:image/jpeg;base64,' + 'B'.repeat(96)
    const result = extractEmbeddedImages(`first ${SAMPLE_PNG_DATA_URL} mid ${second} tail`)

    expect(result.cleanedText).toBe('first  mid  tail')
    expect(result.images).toEqual([SAMPLE_PNG_DATA_URL, second])
  })

  // Guards the crash behind "uploading images fails": four attached photos join
  // into one string of raw data URLs, and an unbounded regex quantifier walking
  // a payload this size overflows V8's backtrack stack -> RangeError: Maximum
  // call stack size exceeded. Identity is asserted with `===` rather than
  // toEqual so a failure doesn't try to diff two multi-megabyte strings.
  it('extracts phone-photo-sized data URLs', () => {
    const first = largeDataUrl(8)
    const second = largeDataUrl(6)
    const result = extractEmbeddedImages(`${first} ${second}`)

    expect(result.images).toHaveLength(2)
    expect(result.images[0] === first).toBe(true)
    expect(result.images[1] === second).toBe(true)
    expect(result.cleanedText).toBe('')
  })
})
