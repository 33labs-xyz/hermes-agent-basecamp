import type { ComposerAttachment } from '@/store/composer'

// What the launchpad composer hands off to the fresh chat when the user hits
// send. Text OR attachments are enough to send: the handed-off chat prefills
// the draft, carries the attachments, and auto-sends on arrival. An empty
// submit (no text, no attachments) sends nothing and just opens a blank chat,
// same as the "New chat" button.
export interface ProjectHandoff {
  attachments: ComposerAttachment[]
  draft: string
  shouldSend: boolean
}

export function buildProjectHandoff(rawText: string, attachments: ComposerAttachment[]): ProjectHandoff {
  const draft = rawText.trim()
  const shouldSend = draft.length > 0 || attachments.length > 0

  return { attachments, draft, shouldSend }
}
