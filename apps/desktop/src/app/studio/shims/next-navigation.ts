// Shim for `next/navigation` so the vendored studio components (authored for
// Next.js) compile and run unmodified under Basecamp's Vite + react-router-dom
// stack. Only the two hooks the studio actually uses are provided.
import { useMemo } from 'react'
import { useNavigate, useParams as useRouterParams } from 'react-router-dom'

// Next's useParams returns a plain record of route params. react-router's
// useParams already matches that shape closely enough for the studio's use
// (it reads optional `id`/`slug`/`tab` keys, all tolerated as undefined here
// since Studio mounts at a flat `/studio` route without those params).
export function useParams<T extends Record<string, string | string[]> = Record<string, string>>(): T {
  return useRouterParams() as unknown as T
}

// Next's useRouter exposes push/replace/back/forward/refresh/prefetch. The
// studio only calls push/replace (to deep-link a workflow). Map those onto
// react-router's navigate; the rest are no-op/best-effort so nothing throws.
export function useRouter() {
  const navigate = useNavigate()

  return useMemo(
    () => ({
      back: () => navigate(-1),
      forward: () => navigate(1),
      prefetch: () => undefined,
      push: (href: string) => navigate(href),
      refresh: () => undefined,
      replace: (href: string) => navigate(href, { replace: true })
    }),
    [navigate]
  )
}

export function usePathname(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
}
