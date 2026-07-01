import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { StudioGenerationEntry } from '@/global'
import { cn } from '@/lib/utils'

import { PAGE_INSET_X } from '../../layout-constants'
import { loadGenerationDataUrl, useGenerations } from './use-generations'

// Local generation manager. Auto-saved results land here grouped by folder.
// Easy delete = archive (reversible); permanent delete is archive-gated behind
// a destructive confirm. Organise re-folders everything by kind.
export function StudioLibrary({ refreshKey }: { refreshKey: number }) {
  const { entries, loading, archive, restore, deleteForever, organise } = useGenerations(refreshKey)
  const [showArchive, setShowArchive] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<StudioGenerationEntry | null>(null)
  const [organising, setOrganising] = useState(false)

  const active = useMemo(() => entries.filter(entry => !entry.archived), [entries])
  const archived = useMemo(() => entries.filter(entry => entry.archived), [entries])

  const byFolder = useMemo(() => groupByFolder(active), [active])

  const runOrganise = async () => {
    setOrganising(true)
    try {
      await organise()
    } finally {
      setOrganising(false)
    }
  }

  if (loading) {
    return <div className="flex h-full min-h-0 flex-1 items-center justify-center" />
  }

  const isEmpty = active.length === 0 && archived.length === 0

  return (
    <div className={cn('flex h-full min-h-0 flex-1 flex-col gap-3 py-3', PAGE_INSET_X)}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="text-xs text-(--ui-text-tertiary)">
          {active.length} saved{archived.length > 0 ? ` · ${archived.length} archived` : ''}
        </div>
        <div className="flex items-center gap-1.5">
          <Button disabled={organising || active.length === 0} onClick={() => void runOrganise()} size="xs" variant="ghost">
            <Codicon name={organising ? 'loading' : 'list-tree'} spinning={organising} />
            Organise
          </Button>
          {archived.length > 0 && (
            <Button onClick={() => setShowArchive(value => !value)} size="xs" variant="ghost">
              <Codicon name="archive" />
              {showArchive ? 'Hide archive' : 'Archive'}
            </Button>
          )}
        </div>
      </div>

      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <Codicon className="size-6 text-(--ui-text-tertiary)" name="sparkle" />
          <p className="max-w-xs text-xs text-(--ui-text-tertiary)">
            No generations yet. Results auto-save here as you create them.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-5 overflow-auto">
          {byFolder.map(([folder, items]) => (
            <section key={folder} className="space-y-2">
              <h3 className="text-xs font-medium text-foreground capitalize">{folder}</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
                {items.map(entry => (
                  <GenerationCard
                    key={entry.id}
                    entry={entry}
                    onArchive={() => void archive(entry.id)}
                  />
                ))}
              </div>
            </section>
          ))}

          {showArchive && archived.length > 0 && (
            <section className="space-y-2 border-t border-border pt-4">
              <h3 className="text-xs font-medium text-(--ui-text-tertiary)">Archive</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
                {archived.map(entry => (
                  <GenerationCard
                    key={entry.id}
                    archived
                    entry={entry}
                    onDeleteForever={() => setPendingDelete(entry)}
                    onRestore={() => void restore(entry.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        confirmLabel="Delete forever"
        description="This removes the file from disk permanently. This cannot be undone."
        destructive
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) await deleteForever(pendingDelete.id)
        }}
        open={pendingDelete !== null}
        title="Delete permanently?"
      />
    </div>
  )
}

interface GenerationCardProps {
  entry: StudioGenerationEntry
  archived?: boolean
  onArchive?: () => void
  onRestore?: () => void
  onDeleteForever?: () => void
}

// One saved generation: media preview + hover actions. Active cards offer a
// one-click archive (easy delete); archived cards offer restore + permanent
// delete. Preview is lazily read off disk as a data URL.
function GenerationCard({ entry, archived, onArchive, onRestore, onDeleteForever }: GenerationCardProps) {
  const dataUrl = useGenerationPreview(entry.path)

  return (
    <div className="group relative overflow-hidden rounded-[4px] border border-border bg-(--ui-bg-tertiary)">
      <div className="flex aspect-square items-center justify-center overflow-hidden">
        <GenerationMedia dataUrl={dataUrl} kind={entry.kind} />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-1 p-1 opacity-0 transition-opacity group-hover:opacity-100">
        {archived ? (
          <>
            <button
              aria-label="Restore"
              className="pointer-events-auto rounded-[3px] bg-black/60 p-1 text-white hover:bg-black/80"
              onClick={onRestore}
              type="button"
            >
              <Codicon name="history" />
            </button>
            <button
              aria-label="Delete forever"
              className="pointer-events-auto rounded-[3px] bg-black/60 p-1 text-white hover:bg-destructive"
              onClick={onDeleteForever}
              type="button"
            >
              <Codicon name="trash" />
            </button>
          </>
        ) : (
          <button
            aria-label="Archive"
            className="pointer-events-auto rounded-[3px] bg-black/60 p-1 text-white hover:bg-black/80"
            onClick={onArchive}
            type="button"
          >
            <Codicon name="archive" />
          </button>
        )}
      </div>

      {entry.prompt && (
        <div className="truncate px-2 py-1.5 text-[0.6875rem] text-(--ui-text-tertiary)" title={entry.prompt}>
          {entry.prompt}
        </div>
      )}
    </div>
  )
}

function GenerationMedia({ dataUrl, kind }: { dataUrl: string; kind: StudioGenerationEntry['kind'] }) {
  if (!dataUrl) {
    return <Codicon className="text-(--ui-text-tertiary)" name={iconForKind(kind)} />
  }

  if (kind === 'video') {
    return <video className="size-full object-cover" controls src={dataUrl} />
  }

  if (kind === 'audio') {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 p-2">
        <Codicon className="size-5 text-(--ui-text-tertiary)" name="music" />
        <audio className="w-full" controls src={dataUrl} />
      </div>
    )
  }

  return <img alt="" className="size-full object-cover" src={dataUrl} />
}

function iconForKind(kind: StudioGenerationEntry['kind']): string {
  if (kind === 'video') return 'device-camera-video'
  if (kind === 'audio') return 'music'
  if (kind === 'image') return 'file-media'
  return 'file'
}

// Group by folder, folders alphabetical for stable ordering.
function groupByFolder(entries: StudioGenerationEntry[]): [string, StudioGenerationEntry[]][] {
  const map = new Map<string, StudioGenerationEntry[]>()

  for (const entry of entries) {
    const folder = entry.folder || 'other'
    const bucket = map.get(folder)

    if (bucket) bucket.push(entry)
    else map.set(folder, [entry])
  }

  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

// Lazily read a generation's bytes off disk as a data URL for inline preview.
function useGenerationPreview(filePath: string | undefined): string {
  const [dataUrl, setDataUrl] = useState('')

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const url = await loadGenerationDataUrl(filePath)

      if (!cancelled) setDataUrl(url)
    })()

    return () => {
      cancelled = true
    }
  }, [filePath])

  return dataUrl
}
