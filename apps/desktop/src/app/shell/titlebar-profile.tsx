import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { openExternalLink } from '@/lib/external-link'
import { pickDisplayedProvider, resolveDefaultProvider } from '@/lib/provider-balances'
import { cn } from '@/lib/utils'
import { $balanceProvider, setBalanceProvider } from '@/store/balance-provider'
import { ensureStudioKeyLoaded } from '@/store/studio-key'

import { formatCredits } from '../studio/use-studio-balance'

import { useOverlayRouting } from './hooks/use-overlay-routing'
import { titlebarButtonClass } from './titlebar'
import { useProviderBalances } from './use-provider-balances'

// Deep links to each provider's own credits/top-up page, opened in the user's
// browser from the balance dropdown. Keys match provider-balances row slugs.
const TOPUP_URLS: Record<string, string> = {
  muapi: 'https://muapi.ai/access-keys',
  openrouter: 'https://openrouter.ai/credits'
}

// Persistent profile control in the titlebar's right cluster. Shows the balance
// of the active provider (OpenRouter-first, Muapi on the Studio screen) beside
// the avatar, with a dropdown to pick which configured provider's balance to
// show. The whole control hides when no configured provider exposes a number.
// Muapi key entry now lives on the Studio screen, not here. Strings stay
// hardcoded English, matching the rest of the surface.
export function TitlebarProfile() {
  const isStudio = useOverlayRouting().currentView === 'studio'
  const selected = useStore($balanceProvider)
  const [open, setOpen] = useState(false)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const rows = useProviderBalances(refreshSignal)

  useEffect(() => {
    // Load the Muapi key so its balance row can populate even before the Studio
    // screen is opened.
    ensureStudioKeyLoaded()
  }, [])

  const hasOk = rows.some(row => row.status === 'ok')
  const displayedSlug = pickDisplayedProvider({
    isStudio,
    selected,
    fallback: resolveDefaultProvider(rows),
    isOk: slug => rows.some(row => row.slug === slug && row.status === 'ok')
  })
  const displayedRow = rows.find(row => row.slug === displayedSlug) ?? null
  const displayedBalance = displayedRow && displayedRow.status === 'ok' ? displayedRow.balance : null
  // Top-up link for whichever provider's balance is on show (null if unknown).
  const topupUrl = displayedSlug ? (TOPUP_URLS[displayedSlug] ?? null) : null

  // Nothing configured exposes a number: hide the whole control.
  if (!hasOk) {
    return null
  }

  return (
    <DropdownMenu
      onOpenChange={next => {
        setOpen(next)

        // Refetch balances each time the picker opens (spec: fetch on open),
        // with no background polling.
        if (next) {
          setRefreshSignal(signal => signal + 1)
        }
      }}
      open={open}
    >
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Profile"
          className={cn(titlebarButtonClass, 'w-auto gap-1.5 px-2')}
          size="icon-titlebar"
          title="Profile"
          type="button"
          variant="ghost"
        >
          <Codicon name="account" />
          {displayedBalance !== null ? (
            <span className="text-xs font-medium tabular-nums" data-testid="titlebar-credits">
              {formatCredits(displayedBalance)}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2.5 py-1.5 text-xs text-muted-foreground">Show balance for</div>
        {rows.map(row => {
          const isOk = row.status === 'ok'

          return (
            <DropdownMenuItem
              className="flex items-center gap-2"
              disabled={!isOk}
              key={row.slug}
              onSelect={event => {
                event.preventDefault()

                if (isOk) {
                  setBalanceProvider(row.slug)
                  setOpen(false)
                }
              }}
            >
              <span className="flex-1 truncate">{row.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {isOk && row.balance !== null
                  ? formatCredits(row.balance)
                  : row.status === 'unsupported'
                    ? 'n/a'
                    : 'unavailable'}
              </span>
              {row.slug === displayedSlug ? <Codicon name="check" size={13} /> : null}
            </DropdownMenuItem>
          )
        })}
        {topupUrl ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="flex items-center gap-2"
              onSelect={event => {
                event.preventDefault()
                openExternalLink(topupUrl)
                setOpen(false)
              }}
            >
              <Codicon name="link-external" size={13} />
              <span className="flex-1 truncate">Top up {displayedRow?.label ?? 'balance'}</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
