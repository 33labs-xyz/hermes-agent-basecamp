import { type ComponentType, createElement, lazy, Suspense } from 'react'

// Shim for `next/dynamic` -> React.lazy + Suspense. The vendored studio uses
// `dynamic(() => import('./X'), { ssr: false, loading: () => <Spinner/> })` to
// defer heavy client-only trees (e.g. the workflow graph builder). Under Vite
// there is no SSR, so `ssr` is ignored; `loading` becomes the Suspense
// fallback.
interface DynamicOptions {
  ssr?: boolean
  loading?: ComponentType
}

type Loader = () => Promise<{ default: ComponentType<Record<string, unknown>> } | ComponentType<Record<string, unknown>>>

export default function dynamic(loader: Loader, options: DynamicOptions = {}) {
  const Lazy = lazy(async () => {
    const mod = await loader()
    // Support both `export default` modules and `.then(m => m.Named)` loaders
    // (which resolve directly to a component).
    const component = (mod as { default?: ComponentType<Record<string, unknown>> }).default ?? mod
    return { default: component as ComponentType<Record<string, unknown>> }
  })

  const Fallback = options.loading

  function DynamicComponent(props: Record<string, unknown>) {
    return createElement(
      Suspense,
      { fallback: Fallback ? createElement(Fallback) : null },
      createElement(Lazy, props)
    )
  }

  return DynamicComponent
}
