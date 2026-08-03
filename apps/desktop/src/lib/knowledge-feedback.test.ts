import { describe, expect, it } from 'vitest'

import { EmptyKnowledgeFileError, UnsupportedKnowledgeFileError } from './knowledge-files'
import { knowledgeAddedMessageKey, knowledgeFailureMessageKey } from './knowledge-feedback'

describe('knowledgeFailureMessageKey', () => {
  it('names the unsupported type for a file that can never become text', () => {
    expect(knowledgeFailureMessageKey('clip.mp4', 'video/mp4', new UnsupportedKnowledgeFileError('clip.mp4'))).toBe(
      'fileUnsupported'
    )
  })

  it('explains the OCR limit when an image holds no words', () => {
    expect(knowledgeFailureMessageKey('photo.png', 'image/png', new EmptyKnowledgeFileError('photo.png'))).toBe(
      'imageNoText'
    )
  })

  it('falls back to the generic unreadable message for other failures', () => {
    expect(knowledgeFailureMessageKey('scan.pdf', 'application/pdf', new Error('boom'))).toBe('fileUnreadable')
    expect(knowledgeFailureMessageKey('shot.png', 'image/png', new Error('worker died'))).toBe('fileUnreadable')
  })
})

describe('knowledgeAddedMessageKey', () => {
  it('tells the user only the text was kept when an image was added', () => {
    expect(knowledgeAddedMessageKey('screenshot.png', 'image/png')).toBe('imageTextAdded')
  })

  it('uses the plain confirmation for everything else', () => {
    expect(knowledgeAddedMessageKey('notes.md', 'text/markdown')).toBe('knowledgeAdded')
    expect(knowledgeAddedMessageKey('brief.pdf', 'application/pdf')).toBe('knowledgeAdded')
  })
})
