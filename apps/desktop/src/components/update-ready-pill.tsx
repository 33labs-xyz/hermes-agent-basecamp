import { useStore } from '@nanostores/react'
import { createPortal } from 'react-dom'

import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $downloadedUpdate, $updateReady, relaunchForUpdate } from '@/store/auto-update'

export function UpdateReadyPill() {
  const { t } = useI18n()
  const ready = useStore($updateReady)
  const downloaded = useStore($downloadedUpdate)

  if (!ready) {
    return null
  }

  const version = downloaded?.version

  // A bottom-left card (not the old skinny pill) modeled on Claude Desktop's
  // relaunch affordance: an icon tile + headline + version line, then a
  // full-width primary Relaunch action. max-w keeps it inside a narrow window.
  // Relaunch is the only exit: the card carried a dismiss control until a
  // tester dismissed it and had no way back, so it now stays until installed.
  return createPortal(
    <div
      className={cn(
        'pointer-events-auto fixed bottom-4 left-4 z-[200] flex w-[19rem] max-w-[calc(100vw-2rem)] flex-col gap-3',
        'rounded-2xl border border-(--stroke-nous) bg-popover/95 p-4 shadow-nous backdrop-blur-md'
      )}
      role="status"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-(--ui-bg-quaternary)">
          <BrandMark className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold text-popover-foreground">{t.autoUpdate.updateAvailable}</span>
          {version ? (
            <span className="text-xs text-muted-foreground">{t.autoUpdate.updateReadyVersion(version)}</span>
          ) : null}
        </div>
      </div>
      <Button
        className="w-full"
        onClick={() => {
          void relaunchForUpdate()
        }}
        type="button"
      >
        {t.autoUpdate.relaunchToUpdate}
      </Button>
    </div>,
    document.body
  )
}
