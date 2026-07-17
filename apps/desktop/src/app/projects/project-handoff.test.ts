import { describe, expect, it } from 'vitest'

import type { ComposerAttachment } from '@/store/composer'

import { buildProjectHandoff } from './project-handoff'

const image = (id: string): ComposerAttachment => ({
  id,
  kind: 'image',
  label: id
})

describe('buildProjectHandoff', () => {
  it('hands off and auto-sends a typed draft, carrying no attachments', () => {
    const handoff = buildProjectHandoff('  hello there  ', [])

    expect(handoff.shouldSend).toBe(true)
    expect(handoff.draft).toBe('hello there')
    expect(handoff.attachments).toEqual([])
  })

  it('hands off and auto-sends when only attachments are present (no text)', () => {
    const attachments = [image('img-1')]
    const handoff = buildProjectHandoff('   ', attachments)

    // An attachment with no text must still send: the user attached an image
    // and hit send. The handed-off chat auto-sends it on arrival.
    expect(handoff.shouldSend).toBe(true)
    expect(handoff.draft).toBe('')
    expect(handoff.attachments).toBe(attachments)
  })

  it('carries both text and attachments through together', () => {
    const attachments = [image('img-1'), image('img-2')]
    const handoff = buildProjectHandoff('look at these', attachments)

    expect(handoff.shouldSend).toBe(true)
    expect(handoff.draft).toBe('look at these')
    expect(handoff.attachments).toBe(attachments)
  })

  it('does not send an empty submit (no text, no attachments)', () => {
    const handoff = buildProjectHandoff('   ', [])

    // Matches the blank "New chat" button: opens an empty chat in the project,
    // nothing stashed, nothing auto-sent.
    expect(handoff.shouldSend).toBe(false)
    expect(handoff.draft).toBe('')
    expect(handoff.attachments).toEqual([])
  })
})
