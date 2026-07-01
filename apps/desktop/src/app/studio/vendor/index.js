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
