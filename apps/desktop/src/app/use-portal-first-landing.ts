import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { isSecondaryWindow } from '../store/windows'

import { portalFirstLandingTarget } from './portal-first-landing'

// Land a fresh launch on the Portal (Learn) view. Fires exactly once at first
// mount: it reads the boot-time route and window kind and -- only for a
// primary-window cold start at the new-chat route -- replaces the history entry
// with the Portal route.
//
// The once-guard (didRunRef) means it never re-runs on later route changes, so
// it does not fight in-session navigation back to '/', and it stays correct
// under React StrictMode's double-invoked mount effect. bootPathnameRef captures
// the initial pathname on first render so the decision uses the launch route
// even though the effect body reads it later.
export function usePortalFirstLanding(): void {
  const navigate = useNavigate()
  const location = useLocation()
  const bootPathnameRef = useRef(location.pathname)
  const didRunRef = useRef(false)

  useEffect(() => {
    if (didRunRef.current) {return}
    didRunRef.current = true

    const target = portalFirstLandingTarget({
      pathname: bootPathnameRef.current,
      secondaryWindow: isSecondaryWindow()
    })

    if (target) {navigate(target, { replace: true })}
  }, [navigate])
}
