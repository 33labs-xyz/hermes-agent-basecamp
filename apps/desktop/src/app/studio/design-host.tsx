import { useEffect } from 'react'

import { setMuapiKey } from './shims/axios'
import { resetStudioRoute } from './shims/next-navigation'
import { DesignAgentStudio, type StudioProps } from './vendor'

// Host for the vendored Design Agent studio. The wrapper fetches its own user
// context from the balance endpoint; the host only syncs the key into the
// axios shim (the design-agent sub-package calls axios without one) and clears
// any stale memory-router route from a previous visit.
export function DesignHost({ apiKey }: StudioProps) {
  useEffect(() => {
    setMuapiKey(apiKey)
  }, [apiKey])

  useEffect(() => {
    resetStudioRoute()
  }, [])

  return <DesignAgentStudio apiKey={apiKey} />
}
