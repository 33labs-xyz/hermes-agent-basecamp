import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { ChevronRight } from '@/lib/icons'

const HERO_CARD_CLASS =
  'group flex flex-col items-start gap-1 rounded-[8px] bg-primary/[0.06] px-3 py-3 text-left transition-colors hover:bg-primary/10'

interface StartChoiceProps {
  onChooseLater: () => void
  onConnectClaude: () => void
  onOtherProvider: () => void
  onUseOpenRouter: () => void
}

// First-run start screen: two equal-weight hero cards (OpenRouter, Claude
// subscription) plus two always-visible escapes (other provider, choose
// later). Pure and callback-driven so the overlay owns all store wiring.
export function StartChoice({ onChooseLater, onConnectClaude, onOtherProvider, onUseOpenRouter }: StartChoiceProps) {
  const { t } = useI18n()
  const c = t.onboarding.startChoice

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <button className={HERO_CARD_CLASS} onClick={onUseOpenRouter} type="button">
          <span className="flex w-full items-center justify-between gap-2 text-[length:var(--conversation-text-font-size)] font-semibold">
            {c.openRouterTitle}
            <ChevronRight className="size-4 shrink-0 text-primary transition group-hover:translate-x-0.5" />
          </span>
          <span className="text-xs leading-5 text-muted-foreground">{c.openRouterSubtitle}</span>
        </button>
        <button className={HERO_CARD_CLASS} onClick={onConnectClaude} type="button">
          <span className="flex w-full items-center justify-between gap-2 text-[length:var(--conversation-text-font-size)] font-semibold">
            {c.claudeTitle}
            <ChevronRight className="size-4 shrink-0 text-primary transition group-hover:translate-x-0.5" />
          </span>
          <span className="text-xs leading-5 text-muted-foreground">{c.claudeSubtitle}</span>
        </button>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-(--ui-stroke-tertiary) pt-3">
        <Button className="font-medium" onClick={onChooseLater} size="xs" type="button" variant="text">
          {t.onboarding.chooseLater}
        </Button>
        <Button className="font-medium" onClick={onOtherProvider} size="xs" type="button" variant="text">
          {c.otherProvider}
        </Button>
      </div>
    </div>
  )
}
