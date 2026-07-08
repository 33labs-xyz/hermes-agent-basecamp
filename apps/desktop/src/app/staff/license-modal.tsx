import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { openExternalLink } from '@/lib/external-link'
import { cn } from '@/lib/utils'
import { saveLicense } from '@/store/staff'

import { PAGE_INSET_X } from '../layout-constants'

import { staffErrorCode } from './errors'

interface StaffLicenseModalProps {
  currentTier: 'free' | 'pro'
  purchaseUrl: string | null
  onClose: () => void
}

// License gate: overlay shell mirrors StudioKeyGate's structure and styling
// (src/app/studio/index.tsx) — click-outside/Escape to dismiss, card stops
// propagation. Swapped for the Staff entitlement contract
// (POST /api/staff/license) instead of the Muapi key.
export function StaffLicenseModal({ currentTier, onClose, purchaseUrl }: StaffLicenseModalProps) {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/50"
      data-testid="staff-license-overlay"
      onClick={onClose}
      onKeyDown={event => {
        if (event.key === 'Escape') {onClose()}
      }}
    >
      <div
        className="relative mx-4 w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg"
        onClick={event => event.stopPropagation()}
      >
        <button
          aria-label="Close"
          className="absolute right-3 top-3 text-muted-foreground transition-colors hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <Codicon name="close" size={14} />
        </button>
        <StaffLicenseGate currentTier={currentTier} onDone={onClose} purchaseUrl={purchaseUrl} />
      </div>
    </div>
  )
}

// Exported standalone (mirrors StudioKeyGate) in case a future entry point
// wants the form without the overlay chrome.
export function StaffLicenseGate({
  currentTier,
  onDone,
  purchaseUrl
}: {
  currentTier: 'free' | 'pro'
  onDone: () => void
  purchaseUrl: string | null
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(key: string) {
    setBusy(true)
    setError('')

    try {
      await saveLicense(key)
      onDone()
    } catch (err) {
      setError(
        staffErrorCode(err) === 'invalid_license'
          ? 'That license key is not valid.'
          : 'Could not save the license key. Try again.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn('flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center', PAGE_INSET_X)}
    >
      <Codicon className="size-8 text-(--ui-text-tertiary)" name="organization" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">
          {currentTier === 'pro' ? 'Manage your Pro license' : 'Unlock Pro staff'}
        </div>
        <p className="max-w-sm text-xs text-(--ui-text-tertiary)">
          Free gets 1 agent with manual runs. Pro unlocks 5 agent slots, scheduled runs, and Pro-only agents.
        </p>
      </div>
      <div className="flex w-full max-w-sm items-center gap-2">
        <Input
          autoFocus
          disabled={busy}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {void submit(draft.trim())}
          }}
          placeholder="License key"
          type="password"
          value={draft}
        />
        <Button disabled={busy || !draft.trim()} onClick={() => void submit(draft.trim())}>
          Save
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {purchaseUrl && currentTier !== 'pro' && (
        <Button disabled={busy} onClick={() => openExternalLink(purchaseUrl)} size="sm" variant="textStrong">
          Get a key
        </Button>
      )}
      {currentTier === 'pro' && (
        <Button disabled={busy} onClick={() => void submit('')} size="sm" variant="ghost">
          Clear license (revert to Free)
        </Button>
      )}
    </div>
  )
}
