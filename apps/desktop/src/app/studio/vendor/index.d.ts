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

// Remaining account credits for the connected key, returned by the Muapi
// balance endpoint. The value is in Muapi credits and may carry decimals.
// `email` identifies the account; the agents/design hosts derive a display
// username from it.
export interface StudioBalance {
  balance: number
  email?: string
}

export function getUserBalance(apiKey: string): Promise<StudioBalance>

export const ImageStudio: ComponentType<StudioProps>
export const VideoStudio: ComponentType<StudioProps>
export const AudioStudio: ComponentType<StudioProps>
export const CinemaStudio: ComponentType<StudioProps>
export const MarketingStudio: ComponentType<StudioProps>
export const RecastStudio: ComponentType<StudioProps>
export const VibeMotionStudio: ComponentType<StudioProps>

// ── Router-driven studios ────────────────────────────────────────────────────
// These navigate via the next/navigation memory-router shim rather than
// callbacks, so their hosts render sub-pages by watching the shim's pathname.

export interface HeaderToggleProps {
  isHeaderVisible?: boolean
  onToggleHeader?: () => void
}

export const WorkflowStudio: ComponentType<{ apiKey: string } & HeaderToggleProps>
export const AgentStudio: ComponentType<{ apiKey: string }>
export const DesignAgentStudio: ComponentType<{ apiKey: string } & HeaderToggleProps>

// Details for one agent as returned by the MuAPI by-slug/by-id endpoints.
// Loose shape: the chat surface passes through whatever the API returns.
export interface AgentDetails {
  agent_id?: string
  id?: string
  slug?: string
  name?: string
  [key: string]: unknown
}

// Minimal user context consumed by the agent pages (upstream sourced this from
// the host site's auth; Basecamp derives it from the MuAPI balance endpoint).
export interface AgentUserContext {
  user: {
    username: string
    name: string
    email: string
    profile_photo: string | null
    balance: number
  } | null
  isAuthorized: boolean
}

export interface AgentPageProps {
  useUser?: () => AgentUserContext
  usedIn?: string
}

export interface AiAgentProps extends AgentPageProps {
  initialAgentDetails?: AgentDetails | null
  initialHistory?: unknown
}

export const AiAgent: ComponentType<AiAgentProps>
export const CreateAgentPage: ComponentType<AgentPageProps>
export const EditAgentPage: ComponentType<AgentPageProps>
export const AgentProfile: ComponentType<AgentPageProps>

export function getAgentDetails(apiKey: string, agentIdOrSlug: string): Promise<AgentDetails>
export function getConversationHistory(
  apiKey: string,
  agentIdOrSlug: string,
  conversationId: string
): Promise<unknown>
