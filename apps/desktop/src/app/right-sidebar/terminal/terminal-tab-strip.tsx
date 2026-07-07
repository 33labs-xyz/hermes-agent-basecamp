import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'

import type { TerminalTabModel } from './terminal-tabs'

interface TerminalTabStripProps {
  tabs: TerminalTabModel[]
  activeId: string
  labels: string[]
  canOpen: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onOpen: () => void
  onHide: () => void
  onRename: (id: string, name: string) => void
}

export function TerminalTabStrip({
  activeId,
  canOpen,
  labels,
  onClose,
  onHide,
  onOpen,
  onRename,
  onSelect,
  tabs
}: TerminalTabStripProps) {
  const { t } = useI18n()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const hideLabel = t.rightSidebar.terminalHide
  // i18n-exempt: hardcoded English pending terminal-tab i18n keys
  const newLabel = 'New terminal'
  // i18n-exempt: hardcoded English pending terminal-tab i18n keys
  const closeLabel = 'Close terminal'
  // i18n-exempt: hardcoded English pending terminal-tab i18n keys
  const renameLabel = 'Rename terminal'
  const showClose = tabs.length > 1

  // Seed with the custom name only — an empty editor means "auto label", so
  // committing it blank reverts the tab instead of freezing the derived label.
  const startRename = (tab: TerminalTabModel) => {
    setEditingId(tab.id)
    setDraft(tab.name ?? '')
  }

  // From the context menu, defer to the next frame: Radix moves focus while it
  // dismisses, so opening the editor inline would mount the autofocused input
  // straight into that churn and blur it shut. One frame later the DOM is
  // settled and the input keeps focus.
  const startRenameAfterMenu = (tab: TerminalTabModel) => {
    requestAnimationFrame(() => startRename(tab))
  }

  const commitRename = () => {
    if (editingId) {
      onRename(editingId, draft)
    }

    setEditingId(null)
  }

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab, index) => {
          const active = tab.id === activeId

          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <div
                  className={`group flex h-6 shrink-0 items-center gap-1 rounded-md pl-2 pr-1 text-[0.72rem] ${
                    active
                      ? 'bg-(--ui-editor-surface-background) text-(--ui-text-primary)'
                      : 'text-(--ui-text-secondary) hover:text-(--ui-text-primary)'
                  }`}
                >
                  {tab.id === editingId ? (
                    <input
                      aria-label={renameLabel}
                      autoFocus
                      className="w-24 bg-transparent outline-none"
                      onBlur={commitRename}
                      onChange={event => setDraft(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') {
                          commitRename()
                        } else if (event.key === 'Escape') {
                          setEditingId(null)
                        }
                      }}
                      placeholder={labels[index]}
                      value={draft}
                    />
                  ) : (
                    <button
                      className="max-w-[10rem] truncate"
                      onClick={() => onSelect(tab.id)}
                      onDoubleClick={() => startRename(tab)}
                      type="button"
                    >
                      {labels[index]}
                    </button>
                  )}
                  {showClose && (
                    <Tip label={closeLabel}>
                      <Button
                        aria-label={closeLabel}
                        className="size-4 rounded text-(--ui-text-tertiary)! opacity-0 group-hover:opacity-100"
                        onClick={() => onClose(tab.id)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <Codicon name="close" size="0.7rem" />
                      </Button>
                    </Tip>
                  )}
                </div>
              </ContextMenuTrigger>
              {/* Keep focus on the autofocused rename input instead of letting
                  Radix return it to the trigger when the menu closes. */}
              <ContextMenuContent onCloseAutoFocus={event => event.preventDefault()}>
                <ContextMenuItem onSelect={() => startRenameAfterMenu(tab)}>{renameLabel}</ContextMenuItem>
                {showClose && (
                  <ContextMenuItem onSelect={() => onClose(tab.id)} variant="destructive">
                    {closeLabel}
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
        <Tip label={newLabel}>
          <Button
            aria-label={newLabel}
            className="size-6 shrink-0 rounded-md text-(--ui-text-secondary)!"
            disabled={!canOpen}
            onClick={onOpen}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Codicon name="add" size="0.875rem" />
          </Button>
        </Tip>
      </div>
      <Tip label={hideLabel}>
        <Button
          aria-label={hideLabel}
          className="ml-1 size-6 shrink-0 rounded-md text-(--ui-text-secondary)!"
          onClick={onHide}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Codicon name="close" size="0.875rem" />
        </Button>
      </Tip>
    </div>
  )
}
