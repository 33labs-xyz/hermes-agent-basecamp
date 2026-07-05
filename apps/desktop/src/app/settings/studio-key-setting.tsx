import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Save } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { bumpStudioBalance } from '@/store/studio-balance'
import { $studioKey, ensureStudioKeyLoaded, saveStudioKey } from '@/store/studio-key'

import { CREDENTIAL_CONTROL_CLASS } from './credential-key-ui'

// Muapi (Studio) key row for Settings > Keys > Tools. The Studio key lives in
// the OS-encrypted store in the main process (studio:key:get/set), a separate
// path from the generic env-var credentials this page otherwise lists, so it
// needs its own row wired to the studio-key store rather than useEnvCredentials.
// First-time entry still happens through the Studio connect gate; this row is
// where an existing key gets rotated. A set key shows masked and read-only and
// edits in place on focus, matching CredentialKeyCard. Strings stay hardcoded
// English to match the rest of the Settings surface.
export function StudioKeySetting() {
  // `null` = not loaded yet; '' = loaded, none stored; non-empty = ready.
  const stored = useStore($studioKey)
  const hasKey = Boolean(stored)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const dirty = draft.trim().length > 0

  useEffect(() => {
    ensureStudioKeyLoaded()
  }, [])

  const save = () => {
    const trimmed = draft.trim()

    if (!trimmed) {
      return
    }

    saveStudioKey(trimmed)
    // This key powers Studio credits; refresh the titlebar readout on change.
    bumpStudioBalance()
    setDraft('')
    setEditing(false)
  }

  const showMasked = hasKey && !editing

  return (
    <div className="rounded-[6px] px-2 py-1">
      <div className="grid gap-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,22rem)] sm:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('size-2 shrink-0 rounded-full', hasKey ? 'bg-primary' : 'bg-(--ui-stroke-secondary)')} />
          <span className="min-w-0 truncate text-[length:var(--conversation-text-font-size)] font-medium text-foreground">
            Muapi
          </span>
        </div>

        <div className="min-w-0 sm:justify-self-end">
          {showMasked ? (
            <Input
              className={cn(CREDENTIAL_CONTROL_CLASS, 'cursor-pointer text-muted-foreground')}
              onFocus={() => {
                setEditing(true)
                setDraft('')
              }}
              readOnly
              value="••••••••"
            />
          ) : (
            <div className="grid gap-1">
              <div className="flex items-center gap-2">
                <Input
                  autoFocus={editing}
                  className={cn(CREDENTIAL_CONTROL_CLASS, 'min-w-0 flex-1')}
                  onChange={event => setDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && dirty) {
                      save()
                    } else if (event.key === 'Escape' && editing) {
                      event.preventDefault()
                      setEditing(false)
                      setDraft('')
                    }
                  }}
                  placeholder="Muapi API key"
                  type="password"
                  value={draft}
                />
                {dirty && (
                  <Button className="h-8 shrink-0" onClick={save} size="sm" type="button">
                    <Save />
                    Save
                  </Button>
                )}
              </div>
              <a
                className="inline-flex w-fit items-center gap-1 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary) underline-offset-4 transition-colors hover:text-foreground hover:underline"
                href="https://muapi.ai/access-keys"
                rel="noreferrer"
                target="_blank"
              >
                Get a Muapi API key
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
