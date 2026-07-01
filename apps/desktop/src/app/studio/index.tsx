import { type ComponentType, useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { PAGE_INSET_X } from '../layout-constants'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'
import { StudioLibrary } from './library'
import {
  AudioStudio,
  CinemaStudio,
  ClippingStudio,
  ImageStudio,
  LipSyncStudio,
  MarketingStudio,
  RecastStudio,
  type StudioGeneration,
  type StudioProps,
  VibeMotionStudio,
  VideoStudio
} from './vendor'

interface StudioViewProps {
  setStatusbarItemGroup: SetStatusbarItemGroup
}

type StudioTabId =
  | 'image'
  | 'video'
  | 'audio'
  | 'cinema'
  | 'clipping'
  | 'lipsync'
  | 'marketing'
  | 'recast'
  | 'vibe'
  | 'library'

interface StudioTab {
  id: StudioTabId
  label: string
  Component?: ComponentType<StudioProps>
}

// Order mirrors the source studio's tab order. Each generation entry is a
// self-contained vendored studio (react + muapi only, zero new npm deps).
// Library is the local generation manager, not a Muapi studio.
const STUDIO_TABS: readonly StudioTab[] = [
  { id: 'image', label: 'Image', Component: ImageStudio },
  { id: 'video', label: 'Video', Component: VideoStudio },
  { id: 'audio', label: 'Audio', Component: AudioStudio },
  { id: 'cinema', label: 'Cinema', Component: CinemaStudio },
  { id: 'clipping', label: 'Clipping', Component: ClippingStudio },
  { id: 'lipsync', label: 'Lip Sync', Component: LipSyncStudio },
  { id: 'marketing', label: 'Marketing', Component: MarketingStudio },
  { id: 'recast', label: 'Body Swap', Component: RecastStudio },
  { id: 'vibe', label: 'Vibe Motion', Component: VibeMotionStudio },
  { id: 'library', label: 'Library' }
]

// Pull every result URL a finished job produced. Studios return either a single
// `url` or a `urls[]`; auto-save persists each one.
function urlsFromGeneration(generation: StudioGeneration): string[] {
  const urls = Array.isArray(generation.urls) ? generation.urls : []
  const single = typeof generation.url === 'string' ? [generation.url] : []
  return [...urls, ...single].filter(Boolean)
}

// The ported generative-AI studio (Muapi BYOK) as a local Basecamp function.
// Results auto-save to the on-disk library (and surface in Artifacts). Transport
// runs through the main-process proxy so the http renderer bypasses CORS.
export function StudioView({ setStatusbarItemGroup }: StudioViewProps) {
  useEffect(() => {
    setStatusbarItemGroup('studio', [])

    return () => setStatusbarItemGroup('studio', [])
  }, [setStatusbarItemGroup])

  // The Muapi key is loaded once from OS-encrypted storage. `null` = still
  // loading; '' = none stored (show the gate); non-empty = ready.
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<StudioTabId>('image')
  // Bumped after each save so the Library refreshes when the user switches to it.
  const [libraryVersion, setLibraryVersion] = useState(0)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const stored = (await window.hermesDesktop?.studio?.getKey()) ?? ''

      if (!cancelled) setApiKey(stored)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const connect = useCallback((key: string) => {
    void window.hermesDesktop?.studio?.setKey(key)
    setApiKey(key)
  }, [])

  // Auto-save: as soon as a job resolves, persist every result to the local
  // library. Best-effort; a save failure never blocks the studio.
  const handleGenerationComplete = useCallback(
    (generation: StudioGeneration) => {
      const gen = window.hermesDesktop?.studio?.gen

      if (!gen) return

      void (async () => {
        for (const url of urlsFromGeneration(generation)) {
          try {
            await gen.save({
              url,
              prompt: typeof generation.prompt === 'string' ? generation.prompt : '',
              model: typeof generation.model === 'string' ? generation.model : '',
              tab: activeTab
            })
          } catch {
            // ignore individual save failures
          }
        }
        setLibraryVersion(version => version + 1)
      })()
    },
    [activeTab]
  )

  if (apiKey === null) {
    return <div className="flex h-full min-h-0 flex-1 items-center justify-center" />
  }

  if (!apiKey) {
    return <StudioKeyGate onSubmit={connect} />
  }

  const active = STUDIO_TABS.find(tab => tab.id === activeTab) ?? STUDIO_TABS[0]
  const ActiveStudio = active.Component

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className={cn('flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border py-1.5', PAGE_INSET_X)}>
        {STUDIO_TABS.map(tab => (
          <button
            aria-pressed={tab.id === active.id}
            className={cn(
              'shrink-0 rounded-[3px] px-2.5 py-1 text-xs font-medium transition-colors',
              tab.id === active.id
                ? 'bg-(--ui-bg-tertiary) text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {ActiveStudio ? (
          <ActiveStudio apiKey={apiKey} onGenerationComplete={handleGenerationComplete} />
        ) : (
          <StudioLibrary refreshKey={libraryVersion} />
        )}
      </div>
    </div>
  )
}

// One-time gate: Studio needs a Muapi key before any studio can mount. The user
// pastes their own key; it is persisted OS-encrypted via safeStorage.
function StudioKeyGate({ onSubmit }: { onSubmit: (key: string) => void }) {
  const [draft, setDraft] = useState('')

  const submit = () => {
    const trimmed = draft.trim()

    if (trimmed) onSubmit(trimmed)
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center', PAGE_INSET_X)}>
      <Codicon className="size-8 text-(--ui-text-tertiary)" name="sparkle" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">Connect Studio</div>
        <p className="max-w-sm text-xs text-(--ui-text-tertiary)">
          Paste your Muapi API key to enable local image, video, and audio generation. Your key is stored encrypted on
          this device.
        </p>
      </div>
      <div className="flex w-full max-w-sm items-center gap-2">
        <Input
          autoFocus
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') submit()
          }}
          placeholder="Muapi API key"
          type="password"
          value={draft}
        />
        <Button disabled={!draft.trim()} onClick={submit}>
          Connect
        </Button>
      </div>
    </div>
  )
}
