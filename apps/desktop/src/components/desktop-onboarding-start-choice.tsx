import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { ChevronRight } from '@/lib/icons'

const HERO_CARD_CLASS =
  'group flex flex-col items-start gap-1 rounded-[8px] bg-primary/[0.06] px-3 py-3 text-left transition-colors hover:bg-primary/10'

interface StartChoiceProps {
  onChooseLater: () => void
  onConnectNous: () => void
  onOtherProvider: () => void
  onUseOpenRouter: () => void
}

// One hero card, kept identical across the three main providers so no single
// path reads as the default. Title on the left with a chevron, subtitle below.
function HeroCard({ onClick, subtitle, title }: { onClick: () => void; subtitle: string; title: string }) {
  return (
    <button className={HERO_CARD_CLASS} onClick={onClick} type="button">
      <span className="flex w-full items-center justify-between gap-2 text-[length:var(--conversation-text-font-size)] font-semibold">
        {title}
        <ChevronRight className="size-4 shrink-0 text-primary transition group-hover:translate-x-0.5" />
      </span>
      <span className="text-xs leading-5 text-muted-foreground">{subtitle}</span>
    </button>
  )
}

// First-run start screen: two equal-weight hero cards (OpenRouter, Nous
// Portal) plus two always-visible escapes (other provider, choose later).
// Claude subscription stays reachable via "Other provider" but is dropped
// from the hero row so first run doesn't lead with a paid subscription. No
// card is badged "recommended" so startup never pushes one provider.
// Pure and callback-driven so the overlay owns all store wiring.
export function StartChoice({ onChooseLater, onConnectNous, onOtherProvider, onUseOpenRouter }: StartChoiceProps) {
  const { t } = useI18n()
  const c = t.onboarding.startChoice

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <HeroCard onClick={onUseOpenRouter} subtitle={c.openRouterSubtitle} title={c.openRouterTitle} />
        <HeroCard onClick={onConnectNous} subtitle={c.nousSubtitle} title={c.nousTitle} />
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
