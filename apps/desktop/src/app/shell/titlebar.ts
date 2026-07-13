import type { HermesConnection } from '@/global'

export const TITLEBAR_HEIGHT = 34
export const MACOS_TRAFFIC_LIGHTS_HEIGHT = 14
export const TITLEBAR_ICON_SIZE = 12
export const TITLEBAR_CONTROL_OFFSET_X = 74
export const TITLEBAR_CONTROL_HEIGHT = 22
export const TITLEBAR_CONTROLS_TOP = (TITLEBAR_HEIGHT - TITLEBAR_CONTROL_HEIGHT) / 2
export const TITLEBAR_FALLBACK_WINDOW_BUTTON_X = 24
// Edge inset used when no left-side native controls take up that space —
// Windows/Linux (native overlay is on the right) and macOS fullscreen
// (traffic lights are hidden). Matches the right-cluster's 0.75rem padding.
export const TITLEBAR_EDGE_INSET = 14

// Titlebar palette only. All sizing/radius/cursor/centering come from the
// shared <Button size="icon-titlebar"> (used polymorphically via asChild) —
// Button is the single source of button styling.
export const titlebarButtonClass =
  'text-muted-foreground/85 hover:bg-(--ui-control-hover-background) hover:text-foreground'

export const titlebarHeaderBaseClass =
  'pointer-events-none relative z-3 flex h-(--titlebar-height) w-full min-w-0 shrink-0 items-center justify-start gap-3 overflow-hidden border-b border-(--ui-stroke-tertiary) bg-(--ui-chat-surface-background) px-[max(0.75rem,var(--titlebar-content-inset,0rem))] pr-[calc(var(--titlebar-tools-right,0.75rem)+var(--titlebar-tools-width,0px)+0.75rem)]'

// Title row inside the header — must stay in the flex truncate chain. An
// explicit flex row with items-center keeps the project chip, separator, and
// title menu vertically centered; left as a block, multiple inline-block
// children align on the text baseline and inflate the line box past the 34px
// titlebar, so items-center centering clips the glyph tops.
export const titlebarHeaderTitleClass = 'flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden'

export const titlebarHeaderShadowClass =
  "after:pointer-events-none after:absolute after:left-0 after:right-0 after:top-full after:h-4 after:bg-linear-to-b after:from-(--ui-chat-surface-background) after:to-transparent after:content-['']"

// Inner gap-x-1 between titlebar buttons, in rem. Also the trailing breather
// the pane-tool cluster leaves before the static system cluster.
export const TITLEBAR_TOOL_GAP_REM = 0.25

// CSS length the titlebar reserves for the static right-edge control cluster
// (browser, haptics, keybinds, the variable-width profile chip, settings, and
// the right-sidebar toggle). Prefer the measured pixel width of the real,
// rendered cluster — a fixed per-button count can't capture the profile chip's
// `w-auto` width and undercounting it lets the pane-tool cluster overlap the
// system cluster. Before the first measurement lands, fall back to a
// conservative per-button estimate (N buttons + N gaps: N-1 inner gap-x-1 plus
// one trailing breather).
export function titlebarControlsReservation(measuredWidth: number, fallbackButtonCount: number): string {
  if (measuredWidth > 0) {
    return `calc(${measuredWidth}px + ${TITLEBAR_TOOL_GAP_REM}rem)`
  }

  return `calc(${fallbackButtonCount} * (var(--titlebar-control-size) + ${TITLEBAR_TOOL_GAP_REM}rem))`
}

export function titlebarControlsPosition(
  windowButtonPosition: HermesConnection['windowButtonPosition'] | undefined,
  isFullscreen = false
) {
  const top = Math.max(0, TITLEBAR_CONTROLS_TOP)

  // No left-side native controls to dodge:
  //   - Windows/Linux: native min/max/close render on the right via titleBarOverlay.
  //   - macOS fullscreen: traffic lights are hidden.
  // In both cases, pin the cluster to the edge with a small inset.
  if (windowButtonPosition === null || isFullscreen) {
    return { left: TITLEBAR_EDGE_INSET, top }
  }

  return {
    left: (windowButtonPosition?.x ?? TITLEBAR_FALLBACK_WINDOW_BUTTON_X) + TITLEBAR_CONTROL_OFFSET_X,
    top
  }
}
