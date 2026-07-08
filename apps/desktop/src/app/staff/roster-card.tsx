import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import type { StaffCatalogEntry, StaffRosterEntry } from '@/hermes'
import { Lock, MoreHorizontal, Trash2 } from '@/lib/icons'
import { cn } from '@/lib/utils'

// Report timestamps are file mtimes in epoch seconds from the backend.
function formatReportTime(atSeconds: number): string {
  return new Date(atSeconds * 1000).toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short'
  })
}

interface StaffRosterSectionProps {
  busyKeys: ReadonlySet<string>
  catalogByKey: ReadonlyMap<string, StaffCatalogEntry>
  onFire: (key: string) => Promise<void>
  onLicenseNeeded: () => void
  onOpenChat: (groupId: string) => void
  onRunNow: (key: string) => Promise<void>
  onToggleSchedule: (row: StaffRosterEntry, defaultTime: string) => Promise<void>
  roster: StaffRosterEntry[]
  schedulesAllowed: boolean
}

// Section 1 of the Staff page: one card per hired agent. Empty roster renders
// nothing here — the empty-state hero (index.tsx) covers that case instead.
export function StaffRosterSection({
  busyKeys,
  catalogByKey,
  onFire,
  onLicenseNeeded,
  onOpenChat,
  onRunNow,
  onToggleSchedule,
  roster,
  schedulesAllowed
}: StaffRosterSectionProps) {
  if (roster.length === 0) {
    return null
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {roster.map(row => (
        <StaffRosterCard
          busy={busyKeys.has(row.key)}
          entry={catalogByKey.get(row.key)}
          key={row.key}
          onFire={onFire}
          onLicenseNeeded={onLicenseNeeded}
          onOpenChat={onOpenChat}
          onRunNow={onRunNow}
          onToggleSchedule={onToggleSchedule}
          row={row}
          schedulesAllowed={schedulesAllowed}
        />
      ))}
    </div>
  )
}

function StaffRosterCard({
  busy,
  entry,
  onFire,
  onLicenseNeeded,
  onOpenChat,
  onRunNow,
  onToggleSchedule,
  row,
  schedulesAllowed
}: {
  busy: boolean
  entry: StaffCatalogEntry | undefined
  onFire: (key: string) => Promise<void>
  onLicenseNeeded: () => void
  onOpenChat: (groupId: string) => void
  onRunNow: (key: string) => Promise<void>
  onToggleSchedule: (row: StaffRosterEntry, defaultTime: string) => Promise<void>
  row: StaffRosterEntry
  schedulesAllowed: boolean
}) {
  const [fireOpen, setFireOpen] = useState(false)
  const name = entry?.name ?? row.key
  const scheduleLine = row.scheduled
    ? row.schedule_time
      ? `Runs daily, ${row.schedule_time}`
      : 'Scheduled'
    : 'Not scheduled'

  async function handleToggle() {
    if (!schedulesAllowed) {
      onLicenseNeeded()

      return
    }

    await onToggleSchedule(row, entry?.default_time || '09:00')
  }

  async function confirmFire() {
    await onFire(row.key)
    setFireOpen(false)
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-(--ui-divider) bg-(--ui-bg-elevated) p-4">
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-(--ui-control-background) text-lg">
          {entry?.icon || '🤖'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="min-w-0 truncate text-[0.875rem] font-semibold tracking-tight">{name}</h3>
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-px text-[0.6rem] font-medium',
                row.scheduled
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
              )}
            >
              {row.scheduled ? 'On duty' : 'Manual only'}
            </span>
          </div>
          <p className="truncate text-[0.75rem] text-(--ui-text-tertiary)">{scheduleLine}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="Agent actions" className="shrink-0" size="icon-sm" variant="ghost">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onSelect={() => setFireOpen(true)} variant="destructive">
              <Trash2 className="size-3.5" />
              Fire
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {row.last_report && (
        <div className="rounded-lg bg-(--ui-control-background) px-3 py-2 text-[0.75rem] leading-snug text-(--ui-text-secondary)">
          <p className="mb-1 text-[0.66rem] font-medium tracking-wide text-(--ui-text-tertiary) uppercase">
            {row.last_report.source === 'scheduled' ? 'Scheduled report' : 'Manual run'} ·{' '}
            {formatReportTime(row.last_report.at)}
            {!row.last_report.ok && <span className="text-destructive"> · Failed</span>}
          </p>
          <p className="line-clamp-4 whitespace-pre-line">{row.last_report.excerpt}</p>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button className="flex-1" onClick={() => onOpenChat(row.group_id)} size="sm" variant="secondary">
            Open chat
          </Button>
          <Button disabled={busy || row.running} onClick={() => void onRunNow(row.key)} size="sm" variant="ghost">
            {row.running ? 'Running…' : 'Run now'}
          </Button>
        </div>
        {schedulesAllowed ? (
          <Switch checked={row.scheduled} disabled={busy} onCheckedChange={() => void handleToggle()} size="xs" />
        ) : (
          <button
            className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-1 text-[0.66rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--ui-control-hover-background) hover:text-foreground"
            onClick={onLicenseNeeded}
            title="Schedules are a Pro feature"
            type="button"
          >
            <Lock className="size-3" />
            Pro
          </button>
        )}
      </div>

      <Dialog onOpenChange={setFireOpen} open={fireOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Fire {name}?</DialogTitle>
            <DialogDescription>
              This removes {name} from your roster and cancels its schedule. Its chat and history are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setFireOpen(false)} type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void confirmFire()} type="button" variant="destructive">
              Fire
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
