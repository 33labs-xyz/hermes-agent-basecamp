import { act, cleanup, render } from '@testing-library/react'
import { useStore } from '@nanostores/react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $composerAttachments,
  clearComposerAttachments,
  type ComposerAttachment,
  stashSessionDraft,
  takeSessionDraft
} from '@/store/composer'
import { setProjectHandoffSend, takeProjectHandoffSend } from '@/store/projects'

afterEach(cleanup)

beforeEach(() => {
  clearComposerAttachments()
  takeSessionDraft(null)
  takeProjectHandoffSend()
})

const cloneAttachments = (attachments: ComposerAttachment[]) => attachments.map(a => ({ ...a }))

// Faithful mirror of index.tsx's mount-time project-handoff path: the
// draft-swap effect (source-order FIRST) restores the stashed handoff into
// draftRef + $composerAttachments, then the handoff auto-send effect (source
// order SECOND, SAME commit) calls submitDraft().
//
// Regression repro: dropping files into the project launchpad composer showed
// them attached, but pressing Enter started the task with no document. Both
// effects run in one commit, so `useStore($composerAttachments)` — a
// render-scoped value — is still the pre-mount empty array while submitDraft
// runs. submitDraft read that stale value for both `payloadPresent` and the
// cloned payload, so it dispatched text with zero attachments (and, for an
// attachment-only handoff, dispatched nothing at all while the one-shot arm
// was already consumed).
function Harness({ onSubmit }: { onSubmit: (text: string, attachments: ComposerAttachment[]) => void }) {
  const draftRef = useRef('')
  // Mirrors index.tsx:187 — render-scoped, lags a store write by a render.
  const attachments = useStore($composerAttachments)

  const loadIntoComposer = (text: string, next: ComposerAttachment[]) => {
    draftRef.current = text
    $composerAttachments.set(cloneAttachments(next))
  }

  const submitDraft = () => {
    const text = draftRef.current
    const liveAttachments = $composerAttachments.get()
    const payloadPresent = text.trim().length > 0 || liveAttachments.length > 0

    if (payloadPresent) {
      const submittedAttachments = cloneAttachments(liveAttachments)
      clearComposerAttachments()
      onSubmit(text, submittedAttachments)
    }
  }

  useEffect(() => {
    const stashed = takeSessionDraft(null)
    loadIntoComposer(stashed.text, stashed.attachments)
  }, [])

  useEffect(() => {
    const hasHandoffPayload = draftRef.current.trim().length > 0 || $composerAttachments.get().length > 0

    if (hasHandoffPayload && takeProjectHandoffSend()) {
      submitDraft()
    }
  }, [])

  // `attachments` is read so the stale render-scoped mirror stays live; the
  // assertions prove submitDraft never relies on it.
  void attachments

  return <div data-testid="composer" />
}

const fileAttachment = (): ComposerAttachment => ({
  detail: 'docs/spec.pdf',
  id: 'att-1',
  kind: 'file',
  label: 'spec.pdf',
  path: '/tmp/spec.pdf',
  refText: '@file:docs/spec.pdf'
})

describe('project handoff auto-send — dropped attachments survive the mount race', () => {
  it('submits the handoff attachments alongside the typed text', async () => {
    const onSubmit = vi.fn()

    stashSessionDraft(null, 'summarise this', [fileAttachment()])
    setProjectHandoffSend(true)

    await act(async () => {
      render(<Harness onSubmit={onSubmit} />)
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('summarise this', [fileAttachment()])
  })

  it('submits an attachment-only handoff (no typed text)', async () => {
    const onSubmit = vi.fn()

    stashSessionDraft(null, '', [fileAttachment()])
    setProjectHandoffSend(true)

    await act(async () => {
      render(<Harness onSubmit={onSubmit} />)
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('', [fileAttachment()])
  })
})
