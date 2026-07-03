import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  resetStudioRoute,
  setStudioRoute,
  useParams,
  usePathname,
  useRouter,
  useSearchParams
} from './next-navigation'

afterEach(() => {
  resetStudioRoute()
})

describe('useParams pattern matching', () => {
  it('returns empty params on the default route', () => {
    const { result } = renderHook(() => useParams())

    expect(result.current).toEqual({})
  })

  it('matches /workflow/:id/:tab', () => {
    setStudioRoute('/workflow/wf-123/editor')
    const { result } = renderHook(() => useParams())

    expect(result.current).toEqual({ id: 'wf-123', tab: 'editor' })
  })

  it('matches /workflow/:id without a tab', () => {
    setStudioRoute('/workflow/wf-123')
    const { result } = renderHook(() => useParams())

    expect(result.current).toEqual({ id: 'wf-123' })
  })

  it('matches /agents/create as a literal, not as an agent id', () => {
    setStudioRoute('/agents/create')
    const { result } = renderHook(() => useParams())

    expect(result.current).toEqual({})
  })

  it('matches /agents/edit/:id', () => {
    setStudioRoute('/agents/edit/agent-9')
    const { result } = renderHook(() => useParams())

    expect(result.current).toEqual({ id: 'agent-9' })
  })

  it('matches /agents/:id/profile as profile, not as a conversation', () => {
    setStudioRoute('/agents/helper-bot/profile')
    const { result } = renderHook(() => useParams())

    // ProfileAgent destructures `agent_id`, so the profile route exposes that key.
    expect(result.current).toEqual({ agent_id: 'helper-bot' })
  })

  it('matches /agents/:id/:conversation_id', () => {
    setStudioRoute('/agents/helper-bot/conv-42')
    const { result } = renderHook(() => useParams())

    expect(result.current).toEqual({ id: 'helper-bot', conversation_id: 'conv-42' })
  })

  it('matches /agents/:id', () => {
    setStudioRoute('/agents/helper-bot')
    const { result } = renderHook(() => useParams())

    expect(result.current).toEqual({ id: 'helper-bot' })
  })

  it('decodes URI-encoded segments', () => {
    setStudioRoute('/agents/my%20agent')
    const { result } = renderHook(() => useParams())

    expect(result.current).toEqual({ id: 'my agent' })
  })

  it('ignores the query string when matching', () => {
    setStudioRoute('/workflow/wf-1/editor?foo=bar')
    const { result } = renderHook(() => useParams())

    expect(result.current).toEqual({ id: 'wf-1', tab: 'editor' })
  })
})

describe('useRouter navigation', () => {
  it('push updates params reactively', () => {
    const { result } = renderHook(() => ({ router: useRouter(), params: useParams() }))

    expect(result.current.params).toEqual({})

    act(() => {
      result.current.router.push('/workflow/wf-7/editor')
    })

    expect(result.current.params).toEqual({ id: 'wf-7', tab: 'editor' })
  })

  it('replace updates the route without growing history', () => {
    const { result } = renderHook(() => ({ router: useRouter(), pathname: usePathname() }))

    act(() => {
      result.current.router.push('/agents/a1')
      result.current.router.replace('/agents/a1/conv-1')
    })
    expect(result.current.pathname).toBe('/agents/a1/conv-1')

    act(() => {
      result.current.router.back()
    })

    // replace did not push a history entry, so back lands on the pre-push path
    expect(result.current.pathname).toBe('/studio')
  })

  it('back returns to the previous pushed path', () => {
    const { result } = renderHook(() => ({ router: useRouter(), pathname: usePathname() }))

    act(() => {
      result.current.router.push('/agents/a1')
      result.current.router.push('/agents/a1/conv-1')
      result.current.router.back()
    })

    expect(result.current.pathname).toBe('/agents/a1')
  })

  it('back on empty history falls back to the default route', () => {
    const { result } = renderHook(() => ({ router: useRouter(), pathname: usePathname() }))

    act(() => {
      result.current.router.back()
    })

    expect(result.current.pathname).toBe('/studio')
  })

  it('returns a stable router identity across renders', () => {
    const { result, rerender } = renderHook(() => useRouter())
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })
})

describe('pathname and search params', () => {
  it('usePathname strips the query string', () => {
    setStudioRoute('/agents/a1?tab=chat')
    const { result } = renderHook(() => usePathname())

    expect(result.current).toBe('/agents/a1')
  })

  it('useSearchParams parses the query string', () => {
    setStudioRoute('/agents/a1?tab=chat&x=1')
    const { result } = renderHook(() => useSearchParams())

    expect(result.current.get('tab')).toBe('chat')
    expect(result.current.get('x')).toBe('1')
  })

  it('resetStudioRoute returns to the default route and clears history', () => {
    const { result } = renderHook(() => ({ router: useRouter(), pathname: usePathname() }))

    act(() => {
      result.current.router.push('/agents/a1')
    })
    resetStudioRoute()

    const { result: after } = renderHook(() => usePathname())
    expect(after.current).toBe('/studio')
  })
})
