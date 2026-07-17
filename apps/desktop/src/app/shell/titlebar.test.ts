import { describe, expect, it } from 'vitest'

import {
  TITLEBAR_CONTROL_OFFSET_X,
  TITLEBAR_EDGE_INSET,
  TITLEBAR_FALLBACK_WINDOW_BUTTON_X,
  titlebarControlsForConnection,
  titlebarControlsPosition,
  titlebarControlsReservation
} from './titlebar'

describe('titlebarControlsPosition', () => {
  it('offsets controls from visible traffic lights', () => {
    expect(titlebarControlsPosition({ x: 24, y: 10 }).left).toBe(24 + TITLEBAR_CONTROL_OFFSET_X)
  })

  it('pins to the edge when macOS fullscreen hides traffic lights', () => {
    expect(titlebarControlsPosition({ x: 24, y: 10 }, true).left).toBe(TITLEBAR_EDGE_INSET)
  })

  it('pins to the edge on Windows/Linux where native controls render on the right', () => {
    expect(titlebarControlsPosition(null).left).toBe(TITLEBAR_EDGE_INSET)
  })

  it('uses the macOS fallback while the initial window state is unknown', () => {
    expect(titlebarControlsPosition(undefined).left).toBe(TITLEBAR_FALLBACK_WINDOW_BUTTON_X + TITLEBAR_CONTROL_OFFSET_X)
  })
})

describe('titlebarControlsForConnection', () => {
  it('dodges the visible traffic lights for a maximized (non-fullscreen) macOS window', () => {
    // A maximized window fills the whole screen but is NOT fullscreen, so the
    // macOS traffic lights stay visible. The cluster position must come from the
    // authoritative connection.isFullscreen (false here), never from viewport
    // size - inferring fullscreen from a screen-filling viewport is exactly what
    // slid the cluster onto the still-visible lights.
    expect(
      titlebarControlsForConnection({ windowButtonPosition: { x: 24, y: 10 }, isFullscreen: false }).left
    ).toBe(24 + TITLEBAR_CONTROL_OFFSET_X)
  })

  it('pins to the edge only when the window is genuinely fullscreen', () => {
    expect(
      titlebarControlsForConnection({ windowButtonPosition: { x: 24, y: 10 }, isFullscreen: true }).left
    ).toBe(TITLEBAR_EDGE_INSET)
  })

  it('uses the macOS fallback while the connection is still unknown', () => {
    expect(titlebarControlsForConnection(null).left).toBe(TITLEBAR_FALLBACK_WINDOW_BUTTON_X + TITLEBAR_CONTROL_OFFSET_X)
  })

  it('pins to the edge on Windows/Linux where native controls render on the right', () => {
    expect(titlebarControlsForConnection({ windowButtonPosition: null, isFullscreen: false }).left).toBe(
      TITLEBAR_EDGE_INSET
    )
  })
})

describe('titlebarControlsReservation', () => {
  it('reserves the measured cluster width plus a breather once measured', () => {
    // The real right-edge cluster is 5 icon buttons + a variable-width profile
    // chip. Measuring it (rather than counting fixed buttons) is what stops the
    // pane-tool cluster from overlapping it.
    expect(titlebarControlsReservation(180, 5)).toBe('calc(180px + 0.25rem)')
  })

  it('tracks a wider (profile-visible) cluster so it never undercounts', () => {
    expect(titlebarControlsReservation(212, 5)).toBe('calc(212px + 0.25rem)')
  })

  it('falls back to a per-button estimate before the first measurement lands', () => {
    expect(titlebarControlsReservation(0, 5)).toBe('calc(5 * (var(--titlebar-control-size) + 0.25rem))')
  })

  it('treats a negative measurement as unmeasured', () => {
    expect(titlebarControlsReservation(-1, 5)).toBe('calc(5 * (var(--titlebar-control-size) + 0.25rem))')
  })
})
