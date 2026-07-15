import { LEARN_ROUTE, NEW_CHAT_ROUTE } from './routes'

// Portal-first landing: the Portal (Learn) view is the first screen a fresh
// launch should land on. A primary-window cold boot is uniquely identified by
// react-router resolving the empty hash to the new-chat route ('/') while the
// window carries no ?win=secondary flag.
//
// Pure by design so the decision is unit-tested in isolation; the calling hook
// fires it exactly once at first mount, so it never fights later in-session
// navigation back to '/'.

export interface PortalLandingInput {
  pathname: string
  secondaryWindow: boolean
}

// Returns the route to redirect to on cold start, or null to stay put.
// Only a primary window booting at the new-chat route is redirected -- pop-out
// secondary windows and any deep-linked route (a resumed session, /settings,
// /skills, or the Portal itself) are left exactly where they are.
export function portalFirstLandingTarget({
  pathname,
  secondaryWindow
}: PortalLandingInput): string | null {
  if (secondaryWindow) {return null}

  if (pathname !== NEW_CHAT_ROUTE) {return null}

  return LEARN_ROUTE
}
