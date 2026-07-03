import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { formatCredits, useStudioBalance } from './use-studio-balance'

interface StudioCreditsProps {
  // Null before a provider key is connected; nothing renders until we have one.
  apiKey: string | null
  // Bump to force a refetch (e.g. after a generation spends credits).
  refreshSignal: number
}

// Subtle top-right pill showing the remaining Muapi credit balance for the
// connected key. Any failure (missing/expired key, network) hides the pill
// rather than surfacing an error in the header.
export function StudioCredits({ apiKey, refreshSignal }: StudioCreditsProps) {
  const balance = useStudioBalance(apiKey, refreshSignal)

  if (balance === null) {return null}

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
