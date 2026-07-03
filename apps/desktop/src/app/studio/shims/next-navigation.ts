import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
// Shim for `next/navigation` backing the vendored studios (authored for
// Next.js) with an in-memory router instead of the app's real react-router.
// The Workflow/Agent studios navigate between their internal views via
// router.push('/workflow/:id/:tab') etc. and re-read those params through
// useParams(); routing them through react-router would navigate the whole
// Basecamp shell away from /studio. The atom keeps that roundtrip contained
// to the studio pane.
import { useMemo } from 'react'

const DEFAULT_PATH = '/studio'

const $route = atom<string>(DEFAULT_PATH)
const history: string[] = []

/** Set the in-memory studio route directly (hosts + tests). */
export function setStudioRoute(path: string): void {
  $route.set(path)
}

/** Reset to the neutral studio route and clear back-history (hosts on mount). */
export function resetStudioRoute(): void {
  history.length = 0
  $route.set(DEFAULT_PATH)
}

/** Current in-memory route, including any query string. */
export function getStudioRoute(): string {
  return $route.get()
}

function stripQuery(path: string): string {
  const queryStart = path.indexOf('?')

  return queryStart === -1 ? path : path.slice(0, queryStart)
}

function queryOf(path: string): string {
  const queryStart = path.indexOf('?')

  return queryStart === -1 ? '' : path.slice(queryStart + 1)
}

// Ordered pattern table for the routes the vendored studios push. Literal
// segments (create/edit/profile) must be tried before the parameterised
// patterns they would otherwise match into.
const ROUTE_PATTERNS: ReadonlyArray<{ regex: RegExp; keys: readonly string[] }> = [
  { regex: /^\/workflow\/([^/]+)\/([^/]+)$/, keys: ['id', 'tab'] },
  { regex: /^\/workflow\/([^/]+)$/, keys: ['id'] },
  { regex: /^\/agents\/create$/, keys: [] },
  { regex: /^\/agents\/edit\/([^/]+)$/, keys: ['id'] },
  { regex: /^\/agents\/([^/]+)\/profile$/, keys: ['agent_id'] },
  { regex: /^\/agents\/([^/]+)\/([^/]+)$/, keys: ['id', 'conversation_id'] },
  { regex: /^\/agents\/([^/]+)$/, keys: ['id'] }
]

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function matchParams(path: string): Record<string, string> {
  for (const { regex, keys } of ROUTE_PATTERNS) {
    const match = regex.exec(path)

    if (match) {
      const params: Record<string, string> = {}

      keys.forEach((key, index) => {
        params[key] = decodeSegment(match[index + 1])
      })

      return params
    }
  }

  return {}
}

// Module-level singleton so useRouter() consumers get a stable identity
// (WorkflowStudio lists `router` in effect dependency arrays).
const router = {
  back: (): void => {
    $route.set(history.pop() ?? DEFAULT_PATH)
  },
  forward: (): void => undefined,
  prefetch: (): void => undefined,
  push: (href: string): void => {
    history.push($route.get())
    $route.set(href)
  },
  refresh: (): void => undefined,
  replace: (href: string): void => {
    $route.set(href)
  }
}

export function useRouter(): typeof router {
  return router
}

export function useParams<
  T extends Record<string, string | string[]> = Record<string, string>
>(): T {
  const path = useStore($route)

  return useMemo(() => matchParams(stripQuery(path)) as T, [path])
}

export function usePathname(): string {
  return stripQuery(useStore($route))
}

export function useSearchParams(): URLSearchParams {
  const path = useStore($route)

  return useMemo(() => new URLSearchParams(queryOf(path)), [path])
}
