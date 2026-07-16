import { useStore } from '@nanostores/react'
import { createPortal } from 'react-dom'

import { BrandMark } from '@/components/brand-mark'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $downloadedUpdate, $updateReady, dismissAutoUpdate, relaunchForUpdate } from '@/store/auto-update'

export function UpdateReadyPill() {
  const { t } = useI18n()
  const ready = useStore($updateReady)
  const downloaded = useStore($downloadedUpdate)

  if (!ready) {
    return null
  }

  const version = downloaded?.version

  return createPortal(
    <div
      className={cn(
        'pointer-events-auto fixed bottom-4 left-4 z-[200] flex items-center gap-2 rounded-full',
        'border border-(--stroke-nous) bg-popover/95 px-3 py-1.5 shadow-nous backdrop-blur-md'
      )}
      role="status"
    >
      <button
        className="flex items-center gap-2 text-sm font-medium text-popover-foreground"
        onClick={() => {
          void relaunchForUpdate()
        }}
        type="button"
      >
        <BrandMark className="size-4" />
        <span>{t.autoUpdate.relaunchToUpdate}</span>
        {version ? (
          <span className="text-xs text-muted-foreground">{t.autoUpdate.updateReadyVersion(version)}</span>
        ) : null}
      </button>
      <button
        aria-label={t.autoUpdate.dismiss}
        className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        onClick={event => {
          event.stopPropagation()
          dismissAutoUpdate()
        }}
        type="button"
      >
        <span aria-hidden>&times;</span>
      </button>
    </div>,
    document.body
  )
}
