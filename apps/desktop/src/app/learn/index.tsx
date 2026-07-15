import { useEffect, useRef, useState } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { openExternalLink } from '@/lib/external-link'

import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

// The embedded Basecamp Portal site (courses + services + product updates).
// Deployed separately on Netlify and served with `frame-ancestors *` so it can
// be embedded in the webview below.
const LEARN_URL = 'https://basecamp-portal-493.netlify.app'

// Portal is live: the tab mounts the embedded webview against LEARN_URL. The
// remote Portal site renders in full; its own click-triggered "coming soon"
// popup gracefully handles the course/service actions that aren't wired up
// yet. Set back to `true` to re-gate behind the native overlay (skips mounting
// the webview so the remote site is never fetched); the index.test.tsx guard
// branches on this value and stays valid either way.
export const COMING_SOON = false

interface LearnViewProps {
  // Route the Portal popup's hermes://new-session link back into the app.
  onGoToNewSession?: () => void
  setStatusbarItemGroup: SetStatusbarItemGroup
}

// Learn: a full-page (non-overlay) view that embeds the external Basecamp site
// in an Electron <webview>. A webview (not an <iframe>) is required — the
// renderer's CSP blocks framing remote origins, but out-of-process webviews are
// exempt and are the same primitive the preview pane uses for remote content
// (see chat/right-rail/preview-pane.tsx). Mounted the same way Studio/Staff are
// (see routes.ts and desktop-controller.tsx).
export function LearnView({ onGoToNewSession, setStatusbarItemGroup }: LearnViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = useState(false)

  // Keep the latest callback in a ref so the webview effect stays mount-once
  // ([] deps): the callback's identity changing each render must not remount
  // the webview (which would refetch the Portal).
  const onGoToNewSessionRef = useRef(onGoToNewSession)
  onGoToNewSessionRef.current = onGoToNewSession

  useEffect(() => {
    setStatusbarItemGroup('learn', [])

    return () => setStatusbarItemGroup('learn', [])
  }, [setStatusbarItemGroup])

  useEffect(() => {
    // Gated: never mount the webview, so the unfinished Portal is not fetched.
    if (COMING_SOON) {
      return
    }

    const host = hostRef.current

    if (!host) {
      return
    }

    setLoadError(false)

    const webview = document.createElement('webview')
    webview.className = 'flex h-full w-full flex-1 bg-transparent'
    webview.setAttribute('partition', 'persist:basecamp-learn')
    webview.setAttribute('src', LEARN_URL)
    webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes')

    // A successful (re)navigation clears any prior failure banner.
    const onNavigate = () => setLoadError(false)

    // did-fail-load fires for real navigation failures (offline, DNS, 5xx).
    // Ignore the benign -3 (ERR_ABORTED) that in-page anchor jumps emit.
    const onFail = (event: Event) => {
      const detail = event as Event & { errorCode?: number }

      if (detail.errorCode === -3) {
        return
      }

      setLoadError(true)
    }

    // The remote Portal uses hermes:// links as in-app action triggers (e.g.
    // the coming-soon popup's "Go to new session"). The webview can't load a
    // hermes:// URL, so cancel the navigation (it aborts as the benign
    // ERR_ABORTED -3 that onFail already ignores) and route it back into the
    // app.
    const onWillNavigate = (event: Event) => {
      const detail = event as Event & { url?: string }

      if (!detail.url?.startsWith('hermes://')) {
        return
      }

      event.preventDefault()

      const action = detail.url.slice('hermes://'.length).replace(/\/+$/, '')

      if (action === 'new-session') {
        onGoToNewSessionRef.current?.()
      }
    }

    webview.addEventListener('did-navigate', onNavigate)
    webview.addEventListener('did-fail-load', onFail)
    webview.addEventListener('will-navigate', onWillNavigate)
    host.replaceChildren(webview)

    return () => {
      webview.removeEventListener('did-navigate', onNavigate)
      webview.removeEventListener('did-fail-load', onFail)
      webview.removeEventListener('will-navigate', onWillNavigate)
      host.replaceChildren()
    }
  }, [])

  // The embedded site fills the whole view, so it must reserve the top
  // titlebar strip (`--titlebar-height`) the same way other full-page views do
  // (see desktop-controller.tsx / settings). Without it, the remote Portal's
  // own top nav renders under the floating window-control cluster (globe,
  // profile chip, settings), which is `fixed` top-right at z-70.
  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col pt-(--titlebar-height)">
      <div className="min-h-0 flex-1" ref={hostRef} />
      {COMING_SOON ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/95 px-6">
          <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
            <BrandMark className="size-14 rounded-2xl" />
            <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-primary">
              Coming soon
            </span>
            <h1 className="text-xl font-semibold text-foreground">Portal</h1>
            <p className="text-sm text-muted-foreground">
              Courses, services and product updates are on the way. Check back shortly.
            </p>
          </div>
        </div>
      ) : loadError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 text-center">
          <p className="text-sm text-muted-foreground">Couldn&apos;t reach the Basecamp site.</p>
          <Button onClick={() => openExternalLink(LEARN_URL)} type="button" variant="secondary">
            Open in browser
          </Button>
        </div>
      ) : null}
    </div>
  )
}
