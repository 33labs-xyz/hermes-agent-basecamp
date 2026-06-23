import { cn } from '@/lib/utils'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

// Brand badge: Basecamp "B" mark, identical in light/dark.
// The mark ships its own rounded tile + sky background; size via className (default size-14).
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md',
        className
      )}
      {...props}
    >
      <img alt="" className="size-full object-contain" src={assetPath('basecamp-mark.png')} />
    </span>
  )
}
