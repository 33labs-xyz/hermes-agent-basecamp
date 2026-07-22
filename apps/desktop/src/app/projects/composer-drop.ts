import { dragHasAttachments } from '@/app/chat/composer/inline-refs'
import { type DroppedFile, extractDroppedFiles, HERMES_PATHS_MIME } from '@/app/chat/hooks/use-composer-actions'

/**
 * Pull attachable drop candidates out of a DataTransfer, synchronously.
 *
 * The Electron drop `DataTransfer` detaches the moment the handler returns, so
 * callers MUST run this inside the drop event, not in a later microtask.
 *
 * Returns `null` when the drag carries nothing attachable (e.g. a plain text
 * selection) so the caller can ignore it and let the textarea handle the drop
 * natively. Otherwise returns the extracted candidates for `attachDroppedItems`.
 */
export function extractComposerDropCandidates(transfer: DataTransfer | null): DroppedFile[] | null {
  if (!dragHasAttachments(transfer, HERMES_PATHS_MIME)) {
    return null
  }

  const candidates = extractDroppedFiles(transfer as DataTransfer)

  return candidates.length ? candidates : null
}
