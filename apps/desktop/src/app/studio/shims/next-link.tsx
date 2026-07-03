import { type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'

import { useRouter } from './next-navigation'

// Shim for `next/link` -> anchor that routes through the studio's in-memory
// router instead of real browser navigation. The vendored studios only link
// between their own internal views (/agents/..., /workflow/...), which the
// memory router resolves back into mounted components.
interface NextLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string
  children?: ReactNode
  prefetch?: boolean
  scroll?: boolean
}

export default function Link({
  href,
  children,
  onClick,
  prefetch: _prefetch,
  scroll: _scroll,
  ...rest
}: NextLinkProps) {
  const router = useRouter()

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)

    if (event.defaultPrevented) {return}

    event.preventDefault()
    router.push(href)
  }

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  )
}
