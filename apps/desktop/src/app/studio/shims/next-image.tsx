import { type CSSProperties, type ImgHTMLAttributes } from 'react'

// Shim for `next/image` -> plain <img>. Next-only optimisation props (fill,
// priority, quality, unoptimized, loader, placeholder, blurDataURL) are
// stripped so they never reach the DOM; `fill` keeps its visual contract via
// absolute positioning, matching how Next renders a filled image.
interface NextImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  fill?: boolean
  priority?: boolean
  quality?: number | string
  unoptimized?: boolean
  loader?: unknown
  placeholder?: string
  blurDataURL?: string
}

const FILL_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover'
}

export default function Image({
  fill,
  priority: _priority,
  quality: _quality,
  unoptimized: _unoptimized,
  loader: _loader,
  placeholder: _placeholder,
  blurDataURL: _blurDataURL,
  style,
  alt = '',
  ...rest
}: NextImageProps) {
  const mergedStyle = fill ? { ...FILL_STYLE, ...style } : style

  return <img alt={alt} style={mergedStyle} {...rest} />
}
