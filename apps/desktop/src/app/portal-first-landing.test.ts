import { describe, expect, it } from 'vitest'

import { LEARN_ROUTE, NEW_CHAT_ROUTE } from './routes'
import { portalFirstLandingTarget } from './portal-first-landing'

// The Portal (Learn) view should be the very first screen a fresh launch lands
// on. A primary-window cold boot is uniquely identified by an empty hash ->
// react-router pathname '/' (NEW_CHAT_ROUTE) with no secondary-window flag.
// Pop-out session windows always carry ?win=secondary, and any deep-linked
// route (a resumed session id, /skills, etc.) is not the new-chat route, so
// neither should be redirected.

describe('portalFirstLandingTarget', () => {
  it('redirects a primary-window cold boot at "/" to the Portal', () => {
    expect(
      portalFirstLandingTarget({ pathname: NEW_CHAT_ROUTE, secondaryWindow: false })
    ).toBe(LEARN_ROUTE)
  })

  it('leaves secondary pop-out windows alone even when they boot at "/"', () => {
    // A new-session pop-out is ?win=secondary#/ -> pathname '/', but it must
    // stay on its scratch session, not jump to the Portal.
    expect(
      portalFirstLandingTarget({ pathname: NEW_CHAT_ROUTE, secondaryWindow: true })
    ).toBeNull()
  })

  it('does not redirect when a session was deep-linked into the primary window', () => {
    expect(
      portalFirstLandingTarget({ pathname: '/abc123session', secondaryWindow: false })
    ).toBeNull()
  })

  it('does not redirect when already on the Portal route', () => {
    expect(
      portalFirstLandingTarget({ pathname: LEARN_ROUTE, secondaryWindow: false })
    ).toBeNull()
  })

  it('does not redirect other full-page routes like settings or skills', () => {
    expect(portalFirstLandingTarget({ pathname: '/settings', secondaryWindow: false })).toBeNull()
    expect(portalFirstLandingTarget({ pathname: '/skills', secondaryWindow: false })).toBeNull()
  })
})
