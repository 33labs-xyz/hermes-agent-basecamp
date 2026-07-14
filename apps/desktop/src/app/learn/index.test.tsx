import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LearnView } from './index'

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
})
