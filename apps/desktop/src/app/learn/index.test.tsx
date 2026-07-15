import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { COMING_SOON, LearnView } from './index'

afterEach(() => {
  cleanup()
})

describe('LearnView', () => {
  // Regression guard: the embedded Portal webview fills the whole view, so its
  // container must reserve the top titlebar strip (--titlebar-height). Without
  // it the remote site's own top nav renders under the floating window-control
  // cluster (globe/profile/settings), which is `fixed` top-right at z-70 -- the
  // 0.17.2 Portal overlap.
  it('reserves the top titlebar strip so the remote nav clears the controls', () => {
    const { container } = render(<LearnView setStatusbarItemGroup={vi.fn()} />)

    const root = container.firstElementChild as HTMLElement

    expect(root.className).toContain('pt-(--titlebar-height)')
  })

  // While the Portal is gated we must show the coming-soon overlay and NOT
  // mount the webview, so the unfinished remote site is never fetched. When the
  // gate is lifted (COMING_SOON === false) the inverse must hold: the webview
  // mounts and no overlay is shown. Branching keeps this guard valid through
  // the flip.
  it('gates the Portal behind a coming-soon overlay while COMING_SOON is set', () => {
    const { container, queryByText } = render(<LearnView setStatusbarItemGroup={vi.fn()} />)

    if (COMING_SOON) {
      expect(queryByText(/coming soon/i)).not.toBeNull()
      expect(container.querySelector('webview')).toBeNull()
    } else {
      expect(queryByText(/coming soon/i)).toBeNull()
      expect(container.querySelector('webview')).not.toBeNull()
    }
  })

  // The remote Portal's coming-soon popup carries a "Go to new session" link
  // (href="hermes://new-session"). That href can't load inside the webview, so
  // the host intercepts the webview's will-navigate for hermes:// URLs, cancels
  // the navigation (aborts as the benign ERR_ABORTED -3), and routes the
  // new-session action back into the app via onGoToNewSession.
  it('intercepts hermes://new-session and routes it in-app', () => {
    if (COMING_SOON) {
      return
    }

    const onGoToNewSession = vi.fn()
    const { container } = render(
      <LearnView onGoToNewSession={onGoToNewSession} setStatusbarItemGroup={vi.fn()} />
    )

    const webview = container.querySelector('webview')
    expect(webview).not.toBeNull()

    const event = new Event('will-navigate', { cancelable: true })
    Object.assign(event, { url: 'hermes://new-session' })
    webview!.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(onGoToNewSession).toHaveBeenCalledTimes(1)
  })

  // Real Portal navigations (the remote site's own https links) must pass
  // through untouched -- only hermes:// app-action links are intercepted.
  it('lets normal https navigations through without routing in-app', () => {
    if (COMING_SOON) {
      return
    }

    const onGoToNewSession = vi.fn()
    const { container } = render(
      <LearnView onGoToNewSession={onGoToNewSession} setStatusbarItemGroup={vi.fn()} />
    )

    const webview = container.querySelector('webview')
    expect(webview).not.toBeNull()

    const event = new Event('will-navigate', { cancelable: true })
    Object.assign(event, { url: 'https://basecamp-portal-493.netlify.app/courses' })
    webview!.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(onGoToNewSession).not.toHaveBeenCalled()
  })
})
