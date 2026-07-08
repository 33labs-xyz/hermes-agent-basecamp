import { useState } from 'react'

import { Button } from '@/components/ui/button'
import type { StaffCatalogEntry, StaffConnectionStatus, StaffConnectResult, StaffEntitlement } from '@/hermes'
import { Check, Link2 } from '@/lib/icons'
import { openExternalLink } from '@/lib/external-link'

interface StaffDirectorySectionProps {
  busyKeys: ReadonlySet<string>
  catalog: StaffCatalogEntry[]
  connections: StaffConnectionStatus[]
  entitlement: StaffEntitlement | null
  hiredKeys: ReadonlySet<string>
  onConnect: (toolkit: string) => Promise<StaffConnectResult>
  onHire: (entry: StaffCatalogEntry) => void
}

// Section 2 of the Staff page: every catalog agent, hired or not, so the
// directory always reads as the full marketplace.
export function StaffDirectorySection({
  busyKeys,
  catalog,
  connections,
  entitlement,
  hiredKeys,
  onConnect,
  onHire
}: StaffDirectorySectionProps) {
  const connectedSlugs = new Set(connections.filter(connection => connection.connected).map(connection => connection.slug))

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {catalog.map(entry => (
        <StaffDirectoryCard
          busy={busyKeys.has(entry.key)}
          connectedSlugs={connectedSlugs}
          entitlement={entitlement}
          entry={entry}
          hired={hiredKeys.has(entry.key)}
          key={entry.key}
          onConnect={onConnect}
          onHire={onHire}
        />
      ))}
    </div>
  )
}

function StaffDirectoryCard({
  busy,
  connectedSlugs,
  entitlement,
  entry,
  hired,
  onConnect,
  onHire
}: {
  busy: boolean
  connectedSlugs: ReadonlySet<string>
  entitlement: StaffEntitlement | null
  entry: StaffCatalogEntry
  hired: boolean
  onConnect: (toolkit: string) => Promise<StaffConnectResult>
  onHire: (entry: StaffCatalogEntry) => void
}) {
  const [connectMessage, setConnectMessage] = useState('')
  const [connectingSlug, setConnectingSlug] = useState('')

  async function handleConnect(slug: string) {
    setConnectingSlug(slug)
    setConnectMessage('')

    try {
      const result = await onConnect(slug)

      if (result.connect_url) {
        openExternalLink(result.connect_url)
      }

      setConnectMessage(result.message)
    } catch {
      setConnectMessage('Could not start the connection. Try again.')
    } finally {
      setConnectingSlug('')
    }
  }

  const isPro = entry.tier === 'pro'
  const locked = isPro && entitlement?.tier !== 'pro'

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-(--ui-divider) bg-(--ui-bg-elevated) p-4">
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-(--ui-control-background) text-lg">
          {entry.icon || '🤖'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="min-w-0 truncate text-[0.875rem] font-semibold tracking-tight">{entry.name}</h3>
            {isPro && (
              <span className="shrink-0 rounded-full bg-(--ui-divider) px-1.5 py-px text-[0.6rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)">
                Pro
              </span>
            )}
          </div>
          <p className="truncate text-[0.75rem] text-(--ui-text-tertiary)">{entry.tagline}</p>
        </div>
      </div>

      {entry.proof.trim() && <p className="text-[0.75rem] leading-snug text-(--ui-text-secondary)">{entry.proof}</p>}

      {entry.requires.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entry.requires.map(slug =>
            connectedSlugs.has(slug) ? (
              <span
                className="flex items-center gap-1 rounded-full border border-(--ui-divider) px-2 py-0.5 text-[0.66rem] text-(--ui-text-tertiary)"
                key={slug}
              >
                <Check className="size-2.5" />
                {slug}
              </span>
            ) : (
              <button
                className="flex items-center gap-1 rounded-full border border-dashed border-(--ui-stroke-tertiary) px-2 py-0.5 text-[0.66rem] text-(--ui-text-tertiary) transition-colors hover:border-(--ui-divider) hover:text-foreground disabled:opacity-50"
                disabled={connectingSlug === slug}
                key={slug}
                onClick={() => void handleConnect(slug)}
                type="button"
              >
                <Link2 className="size-2.5" />
                Connect {slug}
              </button>
            )
          )}
        </div>
      )}

      {connectMessage && <p className="text-[0.7rem] text-(--ui-text-tertiary)">{connectMessage}</p>}

      <Button
        className="mt-auto"
        disabled={hired || busy}
        onClick={() => onHire(entry)}
        size="sm"
        variant={locked ? 'outline' : 'default'}
      >
        {hired ? 'Hired' : locked ? 'Hire (Pro)' : 'Hire'}
      </Button>
    </div>
  )
}
