import { type ReactNode } from 'react'

// Shim for `next-themes`. Basecamp's studio pane is always dark, so the theme
// is pinned; setTheme is a no-op and the provider renders its children as-is.
export function useTheme() {
  return {
    theme: 'dark' as const,
    resolvedTheme: 'dark' as const,
    setTheme: (_theme: string): void => undefined
  }
}

export function ThemeProvider({ children }: { children?: ReactNode }) {
  return <>{children}</>
}
