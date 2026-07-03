// Types for direct imports of muapi.js (the transport module). Import this
// module — not the ./index barrel — from shell code: the barrel re-exports
// every vendored studio JSX file, which would drag the whole studio bundle
// into the titlebar's import graph.
export interface StudioBalance {
  balance?: number
}

export function getUserBalance(apiKey: string): Promise<StudioBalance>
