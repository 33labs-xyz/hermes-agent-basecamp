// An image is stored as the words read out of it, never as the picture, so the
// toasts for images have to say something different from the ones for a file
// whose text was already text. These helpers pick the i18n key; the screen
// looks the message up.

import { EmptyKnowledgeFileError, classifyKnowledgeFile } from './knowledge-files'

export type KnowledgeFailureKey = 'fileUnreadable' | 'fileUnsupported' | 'imageNoText'
export type KnowledgeAddedKey = 'imageTextAdded' | 'knowledgeAdded'

/** Which message explains why a picked file could not be added. */
export function knowledgeFailureMessageKey(fileName: string, mimeType: string, error: unknown): KnowledgeFailureKey {
  if (classifyKnowledgeFile(fileName, mimeType) === 'unsupported') {
    return 'fileUnsupported'
  }

  if (error instanceof EmptyKnowledgeFileError && classifyKnowledgeFile(fileName, mimeType) === 'image') {
    return 'imageNoText'
  }

  return 'fileUnreadable'
}

/** Which message confirms what was actually saved. */
export function knowledgeAddedMessageKey(fileName: string, mimeType: string): KnowledgeAddedKey {
  return classifyKnowledgeFile(fileName, mimeType) === 'image' ? 'imageTextAdded' : 'knowledgeAdded'
}
