import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateAudio } from './muapi.js'

// generateAudio copies params into the request body. The bug: it forwarded
// empty-string optionals, so a seeded but untouched Suno field like
// `persona_model: ''` reached the gateway, whose pydantic Literal rejected the
// blank value with a 422 literal_error. These tests pin the contract that
// empty strings are dropped while genuine falsy values (false, 0) are kept.

describe('generateAudio payload', () => {
  let sentBody

  beforeEach(() => {
    sentBody = null
    // Stub the global fetch the transport shim falls through to (no Basecamp
    // bridge in tests). Return ok with no request_id so submitAndPoll resolves
    // immediately without polling.
    globalThis.fetch = vi.fn(async (_url, init) => {
      sentBody = JSON.parse(init.body)
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({}),
        text: async () => ''
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('omits empty-string optionals so the backend Literal never sees ""', async () => {
    await generateAudio('test-key', {
      _modelId: 'suno-create-music',
      model: 'V5',
      style: 'lofi hip hop',
      persona_model: '',
      persona_id: '',
      title: '',
      negative_tags: ''
    })

    expect(sentBody).not.toHaveProperty('persona_model')
    expect(sentBody).not.toHaveProperty('persona_id')
    expect(sentBody).not.toHaveProperty('title')
    expect(sentBody).not.toHaveProperty('negative_tags')
  })

  it('keeps genuine falsy values (false and 0), not just truthy ones', async () => {
    await generateAudio('test-key', {
      _modelId: 'suno-create-music',
      model: 'V5',
      style: 'lofi hip hop',
      custom_mode: false,
      instrumental: false,
      style_weight: 0
    })

    expect(sentBody.custom_mode).toBe(false)
    expect(sentBody.instrumental).toBe(false)
    expect(sentBody.style_weight).toBe(0)
    expect(sentBody.style).toBe('lofi hip hop')
    expect(sentBody.model).toBe('V5')
  })

  it('never forwards the internal control keys', async () => {
    await generateAudio('test-key', {
      _modelId: 'suno-create-music',
      model: 'V5',
      style: 'lofi hip hop',
      onRequestId: () => {}
    })

    expect(sentBody).not.toHaveProperty('_modelId')
    expect(sentBody).not.toHaveProperty('onRequestId')
  })
})
