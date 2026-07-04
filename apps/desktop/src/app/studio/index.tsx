import { useStore } from '@nanostores/react'
import { type ComponentType, useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { $studioKey, ensureStudioKeyLoaded, saveStudioKey } from '@/store/studio-key'

import { PAGE_INSET_X } from '../layout-constants'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

import { AgentsHost } from './agents-host'
import { DesignHost } from './design-host'
import { StudioLibrary } from './library'
import { StudioCredits } from './studio-credits'
import {
  AudioStudio,
  CinemaStudio,
  ImageStudio,
  MarketingStudio,
  RecastStudio,
  type StudioGeneration,
  type StudioProps,
  VibeMotionStudio,
  VideoStudio
} from './vendor'
import { WorkflowHost } from './workflow-host'

interface StudioViewProps {
  setStatusbarItemGroup: SetStatusbarItemGroup
}

type StudioTabId =
  | 'image'
  | 'video'
  | 'audio'
  | 'cinema'
  | 'marketing'
  | 'recast'
  | 'vibe'
  | 'workflow'
  | 'agents'
  | 'design'
  | 'library'

interface StudioTab {
  id: StudioTabId
  label: string
  Component?: ComponentType<StudioProps>
  // Hard-gated tabs fetch account data on mount (they are browsable galleries,
  // not prompt boxes), so without a key they render the connect prompt instead
  // of the studio rather than waiting for the typing-triggered overlay.
  requiresKey?: true
}

// Order mirrors the source studio's tab order. Each generation entry is a
// self-contained vendored studio (react + muapi only, zero new npm deps).
// Workflow/Agents/Design are the router-driven studios (hosted to bridge
// their Next.js routing onto the memory-router shim). Library is the local
// generation manager, not a Muapi studio.
const STUDIO_TABS: readonly StudioTab[] = [
  { id: 'image', label: 'Image', Component: ImageStudio },
  { id: 'video', label: 'Video', Component: VideoStudio },
  { id: 'audio', label: 'Audio', Component: AudioStudio },
  { id: 'cinema', label: 'Cinema', Component: CinemaStudio },
  { id: 'marketing', label: 'Marketing', Component: MarketingStudio },
  { id: 'recast', label: 'Body Swap', Component: RecastStudio },
  { id: 'vibe', label: 'Vibe Motion', Component: VibeMotionStudio },
  { id: 'workflow', label: 'Workflows', Component: WorkflowHost, requiresKey: true },
  { id: 'agents', label: 'Agents', Component: AgentsHost, requiresKey: true },
  { id: 'design', label: 'Design', Component: DesignHost, requiresKey: true },
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
// Browsable without a key: every tab renders immediately, and the connect
// prompt only appears once the user starts typing into a studio. Results
// auto-save to the on-disk library (and surface in Artifacts). Transport runs
// through the main-process proxy so the http renderer bypasses CORS.
export function StudioView({ setStatusbarItemGroup }: StudioViewProps) {
  useEffect(() => {
    setStatusbarItemGroup('studio', [])

    return () => setStatusbarItemGroup('studio', [])
  }, [setStatusbarItemGroup])

  // `null` = still loading; '' = none stored; non-empty = ready.
  const storedKey = useStore($studioKey)
  const hasKey = Boolean(storedKey)
  const [activeTab, setActiveTab] = useState<StudioTabId>('image')
  // Bumped after each save so the Library refreshes when the user switches to it.
  const [libraryVersion, setLibraryVersion] = useState(0)
  const [keyGateOpen, setKeyGateOpen] = useState(false)
  // Closing the gate without connecting stops it re-opening on every keystroke;
  // switching tabs re-arms it.
  const [keyGateDismissed, setKeyGateDismissed] = useState(false)

  useEffect(() => {
    ensureStudioKeyLoaded()
  }, [])

  const openTab = useCallback((id: StudioTabId) => {
    setActiveTab(id)
    setKeyGateDismissed(false)
  }, [])

  // Typing anywhere inside a studio (prompt boxes included) without a stored
  // key surfaces the connect prompt.
  const handleStudioInput = useCallback(() => {
    if (!hasKey && !keyGateOpen && !keyGateDismissed) {setKeyGateOpen(true)}
  }, [hasKey, keyGateOpen, keyGateDismissed])

  const handleConnect = useCallback((key: string) => {
    saveStudioKey(key)
    setKeyGateOpen(false)
  }, [])

  const dismissKeyGate = useCallback(() => {
    setKeyGateOpen(false)
    setKeyGateDismissed(true)
  }, [])

  // Auto-save: as soon as a job resolves, persist every result to the local
  // library. Best-effort; a save failure never blocks the studio.
  const handleGenerationComplete = useCallback(
    (generation: StudioGeneration) => {
      const gen = window.hermesDesktop?.studio?.gen

      if (!gen) {return}
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

  const active = STUDIO_TABS.find(tab => tab.id === activeTab) ?? STUDIO_TABS[0]
  const ActiveStudio = active.Component

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Tab bar shares the titlebar strip, so its right edge must clear the
          floating window-control cluster (haptics / keybinds / profile /
          settings / sidebar toggle). Same reservation the chat header uses in
          titlebarHeaderBaseClass — keep PAGE_INSET_X for the left content
          gutter, override the right padding to the cluster footprint + gap.
          The pr-[...] wins over PAGE_INSET_X's px-[...] right value, and the
          calc tracks --titlebar-tools-width so it grows with any pane tools. */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 border-b border-border py-1.5',
          PAGE_INSET_X,
          'pr-[calc(var(--titlebar-tools-right,0.75rem)+var(--titlebar-tools-width,0px)+0.75rem)]'
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
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
              onClick={() => openTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <StudioCredits apiKey={storedKey || null} refreshSignal={libraryVersion} />
      </div>
      {/* While the hard gate is showing there is no studio to protect, and the
          typing-trigger would stack the overlay on top of the gate's own input. */}
      <div
        className="relative min-h-0 flex-1 overflow-auto"
        onInputCapture={active.requiresKey && !hasKey ? undefined : handleStudioInput}
      >
        {active.requiresKey && !hasKey ? (
          <StudioKeyGate onSubmit={handleConnect} />
        ) : ActiveStudio ? (
          <ActiveStudio apiKey={storedKey ?? ''} onGenerationComplete={handleGenerationComplete} />
        ) : (
          <StudioLibrary refreshKey={libraryVersion} />
        )}
        {keyGateOpen ? (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/50"
            data-testid="studio-key-overlay"
            onClick={dismissKeyGate}
            onKeyDown={event => {
              if (event.key === 'Escape') {dismissKeyGate()}
            }}
          >
            <div
              className="relative mx-4 w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg"
              onClick={event => event.stopPropagation()}
            >
              <button
                aria-label="Close"
                className="absolute right-3 top-3 text-muted-foreground transition-colors hover:text-foreground"
                onClick={dismissKeyGate}
                type="button"
              >
                <Codicon name="close" size={14} />
              </button>
              <StudioKeyGate onSubmit={handleConnect} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// Connect prompt: pastes a Muapi key, persisted OS-encrypted via safeStorage.
// Rendered inside the typing-triggered overlay (and reusable standalone).
// Exported for tests.
export function StudioKeyGate({ onSubmit }: { onSubmit: (key: string) => void }) {
  const [draft, setDraft] = useState('')

  const submit = () => {
    const trimmed = draft.trim()

    if (trimmed) {onSubmit(trimmed)}
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
            if (event.key === 'Enter') {submit()}
          }}
          placeholder="Muapi API key"
          type="password"
          value={draft}
        />
        <Button disabled={!draft.trim()} onClick={submit}>
          Connect
        </Button>
      </div>
      <a
        className="text-xs text-(--ui-text-tertiary) underline-offset-4 transition-colors hover:text-foreground hover:underline"
        href="https://muapi.ai/access-keys"
        rel="noreferrer"
        target="_blank"
      >
        Get a Muapi API key
      </a>
    </div>
  )
}
