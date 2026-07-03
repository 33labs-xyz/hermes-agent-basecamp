// Barrel for the vendored generative-AI studios. StudioView imports the studios
// from here (typed via index.d.ts) so the .tsx host stays type-checked even
// though tsc ignores the .jsx sources (allowJs:false). Vite bundles the .jsx.
export { default as ImageStudio } from './components/ImageStudio.jsx'
export { default as VideoStudio } from './components/VideoStudio.jsx'
export { default as AudioStudio } from './components/AudioStudio.jsx'
export { default as CinemaStudio } from './components/CinemaStudio.jsx'
export { default as ClippingStudio } from './components/ClippingStudio.jsx'
export { default as LipSyncStudio } from './components/LipSyncStudio.jsx'
export { default as MarketingStudio } from './components/MarketingStudio.jsx'
export { default as RecastStudio } from './components/RecastStudio.jsx'
export { default as VibeMotionStudio } from './components/VibeMotionStudio.jsx'

// Router-driven studios. These navigate via the memory-router shim
// (next/navigation), so their hosts switch sub-views on the shim's pathname.
export { default as WorkflowStudio } from './components/WorkflowStudio.jsx'
export { default as AgentStudio } from './components/AgentStudio.jsx'
export { default as DesignAgentStudio } from './components/DesignAgentStudio.jsx'

// Agent sub-pages rendered by the agents host for its memory-router routes.
// AiAgent is the chat surface; the others are the create/edit/profile pages.
export {
  AiAgent,
  CreateAgentPage,
  EditAgentPage,
  AgentProfile
} from './packages/ai-agent/src/index.js'

// Account credit balance lookup. Routed through the same main-process proxy as
// the studios (see muapi.js muFetch), so no CORS concerns inside Basecamp.
export { getUserBalance } from './muapi.js'
// Agent-detail lookup used by the agents host to hydrate AiAgent, which
// intentionally does not self-fetch (upstream fetched server-side in Next).
export { getAgentDetails, getConversationHistory } from './muapi.js'
