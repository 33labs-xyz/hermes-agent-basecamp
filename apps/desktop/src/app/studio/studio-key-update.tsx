import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { bumpStudioBalance } from '@/store/studio-balance'
import { saveStudioKey } from '@/store/studio-key'

// Studio-screen affordance to change the stored Muapi key. The titlebar no
// longer hosts key entry, so this is where an existing key gets updated; the
// hard gate still handles first-time entry. Strings stay hardcoded English to
// match the rest of the Studio surface.
export function StudioKeyUpdate() {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const save = () => {
    const trimmed = draft.trim()

    if (!trimmed) {
      return
    }

    saveStudioKey(trimmed)
    bumpStudioBalance()
    setDraft('')
    setOpen(false)
  }

  if (!open) {
    return (
      <Button className="shrink-0" onClick={() => setOpen(true)} size="sm" type="button" variant="ghost">
        Update Muapi key
      </Button>
    )
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Input
        autoFocus
        className="h-7 w-44"
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            save()
          } else if (event.key === 'Escape') {
            setOpen(false)
            setDraft('')
          }
        }}
        placeholder="Muapi API key"
        type="password"
        value={draft}
      />
      <Button disabled={!draft.trim()} onClick={save} size="sm" type="button">
        Save
      </Button>
      <a
        className="text-xs text-(--ui-text-tertiary) underline-offset-4 transition-colors hover:text-foreground hover:underline"
        href="https://muapi.ai/access-keys"
        rel="noreferrer"
        target="_blank"
      >
        Get a key
      </a>
    </div>
  )
}
