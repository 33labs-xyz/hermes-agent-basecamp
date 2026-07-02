import { useEffect, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { getUserBalance } from './vendor'

// Muapi credit balances can carry decimals; group thousands and cap at two
// places so 42.5 stays "42.5" and 1234 reads "1,234".
function formatCredits(balance: number): string {
  return balance.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

interface StudioCreditsProps {
  // Null before a provider key is connected; nothing renders until we have one.
  apiKey: string | null
  // Bump to force a refetch (e.g. after a generation spends credits).
  refreshSignal: number
}

// Subtle top-right pill showing the remaining Muapi credit balance for the
// connected key. The lookup routes through the same main-process proxy as the
// studios, so there are no CORS concerns. Any failure (missing/expired key,
// network) hides the pill rather than surfacing an error in the header.
export function StudioCredits({ apiKey, refreshSignal }: StudioCreditsProps) {
  const [balance, setBalance] = useState<number | null>(null)

  useEffect(() => {
    if (!apiKey) {
      setBalance(null)
      return
    }

    let cancelled = false

    void getUserBalance(apiKey)
      .then(result => {
        if (cancelled) return
        const value = result?.balance
        setBalance(typeof value === 'number' && Number.isFinite(value) ? value : null)
      })
      .catch(() => {
        if (!cancelled) setBalance(null)
      })

    return () => {
      cancelled = true
    }
  }, [apiKey, refreshSignal])

  if (balance === null) return null

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full border border-border',
        'bg-(--ui-bg-tertiary) px-2.5 py-1 text-xs text-muted-foreground'
      )}
      data-testid="studio-credits"
      title="Muapi credits remaining"
    >
      <Codicon className="opacity-70" name="credit-card" size={13} />
      <span className="font-medium tabular-nums text-foreground">{formatCredits(balance)}</span>
      <span>credits</span>
    </div>
  )
}
