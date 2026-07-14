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
})
