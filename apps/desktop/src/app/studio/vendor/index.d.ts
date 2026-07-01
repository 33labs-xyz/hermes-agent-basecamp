import type { ComponentType } from 'react'

// A generation result surfaced by a studio when a job finishes. Shape is loose
// on purpose: the vendored studios pass through whatever the Muapi job returned
// (urls, type, prompt, model, etc.). Basecamp's auto-save layer (Phase 4) reads
// the url(s) and type off this and persists locally.
export interface StudioGeneration {
  type?: string
  url?: string
  urls?: string[]
  prompt?: string
  model?: string
  [key: string]: unknown
}

// Props shared by the self-contained generation studios. `apiKey` is the only
// required prop; the rest are optional integration hooks:
//  - onGenerationComplete: fired when a job resolves -> auto-save entrypoint
//  - historyItems: pre-seed the in-studio history strip (unused for now)
//  - droppedFiles / onFilesHandled: drag-drop bridge (unused for now)
export interface StudioProps {
  apiKey: string
  onGenerationComplete?: (generation: StudioGeneration) => void
  historyItems?: StudioGeneration[]
  droppedFiles?: File[]
  onFilesHandled?: () => void
}

export const ImageStudio: ComponentType<StudioProps>
export const VideoStudio: ComponentType<StudioProps>
export const AudioStudio: ComponentType<StudioProps>
export const CinemaStudio: ComponentType<StudioProps>
export const ClippingStudio: ComponentType<StudioProps>
export const LipSyncStudio: ComponentType<StudioProps>
export const MarketingStudio: ComponentType<StudioProps>
export const RecastStudio: ComponentType<StudioProps>
export const VibeMotionStudio: ComponentType<StudioProps>
