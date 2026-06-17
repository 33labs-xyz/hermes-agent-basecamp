'use client'

import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'

import { ChevronDown } from '@/lib/icons'
import { cn } from '@/lib/utils'

const COLLAPSED_PX = 120
const EXPANDED_PX = '40dvh'

interface ExpandableBlockProps {
  children: ReactNode
  className?: string
}

/**
 * Clamps tall content to a compact preview with a gradient + chevron, expanding
 * to a taller (still scrollable) view on click — mirrors the tool-row expand
 * pattern. The inner element is always a scroll container, so any
 * `content-visibility` children render lazily: the browser skips layout/paint
 * for chunks below the fold in both states.
 */
export function ExpandableBlock({ children, className }: ExpandableBlockProps) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const el = innerRef.current

    if (!el) {
      return
    }

    const measure = () => setOverflowing(el.scrollHeight > COLLAPSED_PX + 1)

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  const toggle = useCallback(() => setExpanded(value => !value), [])

  return (
    <div className="relative">
      <div
        className={cn('overflow-y-auto', className)}
        ref={innerRef}
        style={{ maxHeight: expanded ? EXPANDED_PX : COLLAPSED_PX }}
      >
        {children}
      </div>
      {overflowing && (
        <button
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className="absolute inset-x-0 bottom-0 flex h-7 cursor-pointer items-end justify-center pb-1 text-muted-foreground/70 transition-colors bg-linear-to-t from-(--ui-chat-surface-background) to-transparent hover:text-foreground"
          onClick={toggle}
          type="button"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
        </button>
      )}
    </div>
  )
}
