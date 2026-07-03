import { useEffect } from 'react'

import { setMuapiKey } from './shims/axios'
import { resetStudioRoute } from './shims/next-navigation'
import { type StudioProps, WorkflowStudio } from './vendor'

// Host for the vendored Workflow studio. WorkflowStudio drives its own
// list/builder views through the memory-router shim, so the host only has to
// sync the key into the axios shim (the workflow-builder sub-package calls
// axios without one) and clear any stale route left by a previous visit.
export function WorkflowHost({ apiKey }: StudioProps) {
  useEffect(() => {
    setMuapiKey(apiKey)
  }, [apiKey])

  useEffect(() => {
    resetStudioRoute()
  }, [])

  return <WorkflowStudio apiKey={apiKey} />
}
