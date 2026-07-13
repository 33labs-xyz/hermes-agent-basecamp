import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { openExternalLink } from '@/lib/external-link'

import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

// The embedded Basecamp Portal site (courses + services + product updates).
// Deployed separately on Netlify and served with `frame-ancestors *` so it can
// be embedded in the webview below.
const LEARN_URL = 'https://basecamp-portal-493.netlify.app'

interface LearnViewProps {
  setStatusbarItemGroup: SetStatusbarItemGroup
}

// Learn: a full-page (non-overlay) view that embeds the external Basecamp site
// in an Electron <webview>. A webview (not an <iframe>) is required — the
// renderer's CSP blocks framing remote origins, but out-of-process webviews are
// exempt and are the same primitive the preview pane uses for remote content
// (see chat/right-rail/preview-pane.tsx). Mounted the same way Studio/Staff are
// (see routes.ts and desktop-controller.tsx).
export function LearnView({ setStatusbarItemGroup }: LearnViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    setStatusbarItemGroup('learn', [])

    return () => setStatusbarItemGroup('learn', [])
  }, [setStatusbarItemGroup])

  useEffect(() => {
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

    webview.addEventListener('did-navigate', onNavigate)
    webview.addEventListener('did-fail-load', onFail)
    host.replaceChildren(webview)

    return () => {
      webview.removeEventListener('did-navigate', onNavigate)
      webview.removeEventListener('did-fail-load', onFail)
      host.replaceChildren()
    }
  }, [])

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1" ref={hostRef} />
      {loadError ? (
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
