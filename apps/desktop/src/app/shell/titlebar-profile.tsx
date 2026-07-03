import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { $studioKey, ensureStudioKeyLoaded, saveStudioKey } from '@/store/studio-key'

import { formatCredits, useStudioBalance } from '../studio/use-studio-balance'

import { titlebarButtonClass } from './titlebar'

// Persistent profile control in the titlebar's right cluster. Shows the Muapi
// credit balance next to the avatar once a key is connected; the dropdown
// carries the add/update key form (appears automatically while no key is
// stored). Strings stay hardcoded English like the rest of the Studio surface.
export function TitlebarProfile() {
  const storedKey = useStore($studioKey)
  const hasKey = Boolean(storedKey)
  const balance = useStudioBalance(storedKey || null, 0)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    ensureStudioKeyLoaded()
  }, [])

  // No stored key → the form IS the dropdown. With a key, the form hides
  // behind an explicit "Update Muapi key" row.
  const showForm = !hasKey || editing

  const save = () => {
    const trimmed = draft.trim()

    if (!trimmed) {return}
    saveStudioKey(trimmed)
    setDraft('')
    setEditing(false)
    setOpen(false)
  }

  return (
    <DropdownMenu
      onOpenChange={nextOpen => {
        setOpen(nextOpen)

        if (!nextOpen) {setEditing(false)}
      }}
      open={open}
    >
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Profile"
          className={cn(titlebarButtonClass, 'w-auto gap-1.5 bg-transparent px-1.5 select-none')}
          onPointerDown={event => event.stopPropagation()}
          size="icon-titlebar"
          title="Profile"
          type="button"
          variant="ghost"
        >
          <Codicon name="account" />
          {balance !== null ? (
            <span className="text-xs font-medium tabular-nums" data-testid="titlebar-credits">
              {formatCredits(balance)}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {hasKey && balance !== null ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground">
            <Codicon className="opacity-70" name="credit-card" size={13} />
            <span className="font-medium tabular-nums text-foreground">{formatCredits(balance)}</span>
            <span>credits remaining</span>
          </div>
        ) : null}
        {showForm ? (
          <div
            className="space-y-2 px-2.5 py-2"
            onKeyDown={event => {
              // Keep printable keys out of Radix's typeahead; Escape still
              // closes the menu.
              if (event.key !== 'Escape') {event.stopPropagation()}
            }}
          >
            <div className="text-xs font-medium text-foreground">{hasKey ? 'Update Muapi key' : 'Add Muapi key'}</div>
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {save()}
                }}
                placeholder="Muapi API key"
                type="password"
                value={draft}
              />
              <Button disabled={!draft.trim()} onClick={save} size="sm">
                Save
              </Button>
            </div>
            <a
              className="block text-xs text-(--ui-text-tertiary) underline-offset-4 transition-colors hover:text-foreground hover:underline"
              href="https://muapi.ai/access-keys"
              rel="noreferrer"
              target="_blank"
            >
              Get a Muapi API key
            </a>
          </div>
        ) : (
          <DropdownMenuItem
            onSelect={event => {
              event.preventDefault()
              setEditing(true)
            }}
          >
            <Codicon name="key" size={13} />
            Update Muapi key
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
