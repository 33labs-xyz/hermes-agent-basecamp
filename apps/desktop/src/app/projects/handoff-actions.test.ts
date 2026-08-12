import { beforeEach, describe, expect, it, vi } from 'vitest'

import { $composerAttachments, clearSessionDraft, type ComposerAttachment, takeSessionDraft } from '@/store/composer'
import { $pendingProjectGroupId, $pendingProjectHandoffSend } from '@/store/projects'

import { NEW_CHAT_ROUTE } from '../routes'

import { startProjectChat } from './handoff-actions'

const image = (id: string): ComposerAttachment => ({
  id,
  kind: 'image',
  label: id
})

describe('startProjectChat', () => {
  beforeEach(() => {
    $pendingProjectGroupId.set(null)
    $pendingProjectHandoffSend.set(false)
    $composerAttachments.set([])
    clearSessionDraft(null)
  })

  it('opens a blank chat armed for the project when there is no payload', () => {
    const navigate = vi.fn()

    startProjectChat({ navigate, projectId: 'group-1' })

    expect($pendingProjectGroupId.get()).toBe('group-1')
    expect($pendingProjectHandoffSend.get()).toBe(false)
    expect(navigate).toHaveBeenCalledWith(NEW_CHAT_ROUTE)
  })

  it('stashes the draft under the null key and arms auto-send when text is present', () => {
    const navigate = vi.fn()

    startProjectChat({ navigate, projectId: 'group-1', text: '  ship it  ' })

    expect($pendingProjectHandoffSend.get()).toBe(true)
    expect(takeSessionDraft(null)).toEqual({ attachments: [], text: 'ship it' })
    expect(navigate).toHaveBeenCalledWith(NEW_CHAT_ROUTE)
  })

  it('carries attachments across and clears the live attachment atom', () => {
    const navigate = vi.fn()
    const attachments = [image('img-1')]

    $composerAttachments.set(attachments)
    startProjectChat({ attachments, navigate, projectId: 'group-1' })

    expect($pendingProjectHandoffSend.get()).toBe(true)
    expect($composerAttachments.get()).toEqual([])
    expect(takeSessionDraft(null)).toEqual({ attachments, text: '' })
  })

  it('starts an unassigned chat when no project is given', () => {
    const navigate = vi.fn()

    $pendingProjectGroupId.set('stale-group')
    startProjectChat({ navigate, projectId: null, text: 'hello' })

    // A chat started outside any project must not inherit a stale arm.
    expect($pendingProjectGroupId.get()).toBeNull()
    expect($pendingProjectHandoffSend.get()).toBe(true)
  })
})
