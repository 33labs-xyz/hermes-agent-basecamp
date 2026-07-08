import { useStore } from '@nanostores/react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import type { StaffCatalogEntry, StaffRosterEntry } from '@/hermes'
import { Plus, Users } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import {
  $staffBusyKeys,
  $staffCatalog,
  $staffCatalogLoading,
  $staffState,
  $staffStateLoading,
  connectToolkit,
  ensureStaffLoaded,
  fireAgent,
  hireAgent,
  runAgent,
  scheduleAgent,
  unscheduleAgent
} from '@/store/staff'

import { PAGE_INSET_X } from '../layout-constants'
import { projectRoute } from '../routes'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

import { StaffDirectorySection } from './directory-card'
import { staffErrorCode, staffFriendlyError } from './errors'
import { StaffLicenseModal } from './license-modal'
import { StaffRosterSection } from './roster-card'

interface StaffViewProps {
  setStatusbarItemGroup: SetStatusbarItemGroup
}

// Staff: a marketplace of hireable background agents. Each hired agent is
// backed by a chat group (project) and, once scheduled, a cron job. Full-page
// (non-overlay) view, mounted the same way Studio/Projects are — see
// routes.ts and desktop-controller.tsx.
export function StaffView({ setStatusbarItemGroup }: StaffViewProps) {
  useEffect(() => {
    setStatusbarItemGroup('staff', [])

    return () => setStatusbarItemGroup('staff', [])
  }, [setStatusbarItemGroup])

  useEffect(() => {
    ensureStaffLoaded()
  }, [])

  const navigate = useNavigate()
  const catalog = useStore($staffCatalog)
  const state = useStore($staffState)
  const catalogLoading = useStore($staffCatalogLoading)
  const stateLoading = useStore($staffStateLoading)
  const busyKeys = useStore($staffBusyKeys)
  const [licenseOpen, setLicenseOpen] = useState(false)
  const directoryRef = useRef<HTMLDivElement>(null)

  const catalogByKey = useMemo(() => new Map(catalog.map(entry => [entry.key, entry])), [catalog])
  const hiredKeys = useMemo(() => new Set((state?.roster ?? []).map(row => row.key)), [state])

  function scrollToDirectory() {
    directoryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleOpenChat(groupId: string) {
    navigate(projectRoute(groupId))
  }

  async function handleHire(entry: StaffCatalogEntry) {
    try {
      await hireAgent(entry.key)
      notify({ durationMs: 2_000, kind: 'success', message: `${entry.name} is hired.` })
    } catch (err) {
      if (staffErrorCode(err) === 'pro_required') {
        setLicenseOpen(true)

        return
      }

      notifyError(err, staffFriendlyError(err, `Could not hire ${entry.name}.`))
    }
  }

  async function handleFire(key: string) {
    const name = catalogByKey.get(key)?.name ?? 'Agent'

    try {
      await fireAgent(key)
      notify({ durationMs: 2_000, kind: 'success', message: `${name} is fired.` })
    } catch (err) {
      notifyError(err, staffFriendlyError(err, `Could not fire ${name}.`))
    }
  }

  async function handleRunNow(key: string) {
    const name = catalogByKey.get(key)?.name ?? 'Agent'

    try {
      await runAgent(key)
      notify({
        durationMs: 4_000,
        kind: 'success',
        message: `${name} is on it — the report lands here in a few minutes.`
      })
    } catch (err) {
      if (staffErrorCode(err) === 'run_in_progress') {
        notify({ durationMs: 3_000, kind: 'info', message: `${name} is already running.` })

        return
      }

      notifyError(err, staffFriendlyError(err, `Could not start ${name}.`))
    }
  }

  async function handleToggleSchedule(row: StaffRosterEntry, defaultTime: string) {
    try {
      if (row.scheduled) {
        await unscheduleAgent(row.key)
      } else {
        await scheduleAgent(row.key, row.schedule_time ?? defaultTime)
      }
    } catch (err) {
      if (staffErrorCode(err) === 'pro_required') {
        setLicenseOpen(true)

        return
      }

      notifyError(err, staffFriendlyError(err, 'Could not update the schedule.'))
    }
  }

  const roster = state?.roster ?? []
  const entitlement = state?.entitlement ?? null
  const slotsUsed = roster.length
  const slotsTotal = entitlement?.slots ?? 0
  const stillLoading = (catalogLoading || stateLoading) && catalog.length === 0 && state === null

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className={cn('flex shrink-0 items-center gap-2 border-b border-border py-2.5', PAGE_INSET_X)}>
        <Users className="size-4 shrink-0 text-(--ui-text-tertiary)" />
        <h2 className="min-w-0 truncate text-[0.9375rem] font-semibold tracking-tight">Your staff</h2>
        {entitlement && (
          <span className="shrink-0 text-[0.75rem] text-(--ui-text-tertiary) tabular-nums">
            {slotsUsed} of {slotsTotal} slots
          </span>
        )}
        <Button className="ml-auto" onClick={scrollToDirectory} size="sm" variant="textStrong">
          <Plus className="size-3.5" />
          Hire agent
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className={cn('mx-auto max-w-5xl space-y-8 py-6', PAGE_INSET_X)}>
          {stillLoading ? (
            <div className="py-10 text-center text-sm text-(--ui-text-tertiary)">…</div>
          ) : roster.length === 0 ? (
            <StaffEmptyState onHire={scrollToDirectory} />
          ) : (
            <section>
              <SectionHeading>Your roster</SectionHeading>
              <div className="mt-3">
                <StaffRosterSection
                  busyKeys={busyKeys}
                  catalogByKey={catalogByKey}
                  onFire={handleFire}
                  onLicenseNeeded={() => setLicenseOpen(true)}
                  onOpenChat={handleOpenChat}
                  onRunNow={handleRunNow}
                  onToggleSchedule={handleToggleSchedule}
                  roster={roster}
                  schedulesAllowed={Boolean(entitlement?.schedules)}
                />
              </div>
            </section>
          )}

          <section ref={directoryRef}>
            <SectionHeading>Directory</SectionHeading>
            <div className="mt-3">
              <StaffDirectorySection
                busyKeys={busyKeys}
                catalog={catalog}
                connections={state?.connections ?? []}
                entitlement={entitlement}
                hiredKeys={hiredKeys}
                onConnect={connectToolkit}
                onHire={entry => void handleHire(entry)}
              />
            </div>
          </section>
        </div>

        {licenseOpen && (
          <StaffLicenseModal currentTier={entitlement?.tier ?? 'free'} onClose={() => setLicenseOpen(false)} />
        )}
      </div>
    </div>
  )
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{children}</h3>
}

function StaffEmptyState({ onHire }: { onHire: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-(--ui-divider) py-14 text-center">
      <Users className="size-8 text-(--ui-text-tertiary)" />
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">Hire your first agent</h3>
        <p className="max-w-sm text-xs text-(--ui-text-tertiary)">
          Staff are background agents you can run manually or schedule to run on their own. Pick one from the
          directory below to get started.
        </p>
      </div>
      <Button onClick={onHire} size="sm" variant="textStrong">
        <Plus className="size-3.5" />
        Browse directory
      </Button>
    </div>
  )
}
