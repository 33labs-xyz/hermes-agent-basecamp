import { clearComposerAttachments, type ComposerAttachment, stashSessionDraft } from '@/store/composer'
import { setPendingProjectForNewChat, setProjectHandoffSend } from '@/store/projects'

import { NEW_CHAT_ROUTE } from '../routes'

import { buildProjectHandoff } from './project-handoff'

export interface StartProjectChatOptions {
  attachments?: ComposerAttachment[]
  navigate: (to: string) => void
  /** Project the new chat should land in; null starts an unassigned chat. */
  projectId: string | null
  text?: string
}

// Open a fresh chat, optionally carrying a draft and optionally assigning it to
// a project. Arming the one-shot atoms and navigating to the blank-chat route is
// the whole handoff: `useRouteResume` clears the previous session's busy state,
// the composer picks the stashed draft back up, and the next backend session
// created for the send consumes the project arm.
//
// Shared by the project launchpad composer, the project page's "New chat"
// button, and the in-chat "New chat" action so a running turn never blocks
// starting a second one.
export function startProjectChat({ attachments, navigate, projectId, text }: StartProjectChatOptions): void {
  const handoff = buildProjectHandoff(text ?? '', attachments ?? [])

  setPendingProjectForNewChat(projectId)
  setProjectHandoffSend(handoff.shouldSend)

  if (handoff.shouldSend) {
    stashSessionDraft(null, handoff.draft, handoff.attachments)
    // The stashed draft owns the attachments now; clear the live atom so they
    // don't double-apply or linger in the composer we're navigating away from.
    clearComposerAttachments()
  }

  navigate(NEW_CHAT_ROUTE)
}
