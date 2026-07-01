# Basecamp Provider Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it easy, at first run and in Settings, to either use OpenRouter or connect an existing Claude subscription, reusing the backend `claude-code` provider with no new authentication code.

**Architecture:** Frontend-only surfacing on `apps/desktop`. A first-run start screen offers two hero cards (OpenRouter, Claude subscription) plus two escapes (other provider, choose later). The model-picker empty state splits its single connect action into the same two choices. Settings > Models gains a dedicated "Claude subscription" connect row. Copy renames the buried `claude-code` label to "Claude subscription". A small durable store field (`initialApiKeyEnv`) plus a `startManualApiKey` action preselect the OpenRouter key form after first run, mirroring the existing `localEndpoint` pattern (needed because a manual provider refresh flips `mode` back to `oauth`).

**Tech Stack:** React 19 + TypeScript, nanostores (`@nanostores/react`), @tanstack/react-query, vitest + @testing-library/react (jsdom), i18n via `useI18n` with locale files en/ja/zh/zh-hant and a shared `types.ts` shape.

**Scope (Phase A only):** This plan delivers connect + discoverability. A non-destructive "Disconnect" for the external `claude-code` provider requires backend Python (clearing only Basecamp's selection, never `~/.claude/.credentials.json`) that vitest cannot cover; it is deferred to its own follow-on spec/plan. The Settings row therefore shows Connect (disconnected) and a Connected indicator (connected), with no disconnect button in this plan.

**Standing constraints:** No em dashes or en dashes in any shipped string or doc (hyphens only). Never stage unrelated dirty files. The `docs/superpowers/` directory is gitignored, so committing this plan needs `git add -f`. Disconnect must NEVER delete the user's global `~/.claude/.credentials.json` (not in scope here, but keep it in mind if tempted to add one).

**Test commands (run from `apps/desktop`):**
- UI unit tests: `npx vitest run --environment jsdom src/`
- Typecheck: `npm run typecheck`

---

## File Structure

Files created or modified, and their responsibility:

- **Modify** `apps/desktop/src/store/onboarding.ts` - add the durable `initialApiKeyEnv` state field and the `startManualApiKey` action; clear the field wherever we leave the api-key-preselect intent.
- **Create** `apps/desktop/src/store/onboarding-provider-choice.test.ts` - focused unit tests for the new store behavior.
- **Create** `apps/desktop/src/components/desktop-onboarding-start-choice.tsx` - the presentational `StartChoice` first-run chooser (four callbacks, no store coupling).
- **Create** `apps/desktop/src/components/desktop-onboarding-start-choice.test.tsx` - tests for `StartChoice`.
- **Modify** `apps/desktop/src/components/desktop-onboarding-overlay.tsx` - rename the `claude-code` display label + raise its order; wire `StartChoice` into `Picker` and generalize the streamlined OpenRouter form branch.
- **Modify** `apps/desktop/src/components/desktop-onboarding-overlay.test.tsx` - update the now-outdated "OpenRouter-first run" tests to go through the chooser; add the `initialApiKeyEnv` field to existing state literals.
- **Modify** `apps/desktop/src/app/shell/model-menu-panel.tsx` - split the empty-state connect action into two quick actions (extract a testable `EmptyModelActions`).
- **Create** `apps/desktop/src/app/shell/model-menu-panel.empty-actions.test.tsx` - tests for `EmptyModelActions`.
- **Modify** `apps/desktop/src/app/settings/model-settings.tsx` - add the `ClaudeSubscriptionRow` connect row (extracted + exported for testing) and render it under the main-model picker.
- **Create** `apps/desktop/src/app/settings/claude-subscription-row.test.tsx` - tests for `ClaudeSubscriptionRow`.
- **Modify** i18n: `apps/desktop/src/i18n/en.ts`, `ja.ts`, `zh.ts`, `zh-hant.ts`, and `types.ts` - add the new copy keys. Non-English locales get the English string as a temporary fallback pending translation; `npm run typecheck` enforces that every locale has every new key.

---

## Task 1: Copy - rename `claude-code` provider label

**Files:**
- Modify: `apps/desktop/src/components/desktop-onboarding-overlay.tsx` (PROVIDER_DISPLAY map, lines 169-179)
- Test: `apps/desktop/src/components/desktop-onboarding-overlay.test.tsx`

The `claude-code` entry is currently titled `'Anthropic OAuth: Required Extra Usage Credits to Use Subscription'` with `order: 6` (buried last). `providerTitle(p)` returns `PROVIDER_DISPLAY[p.id]?.title ?? p.name` and is exported, so it is directly testable.

- [ ] **Step 1: Write the failing test**

Add to `desktop-onboarding-overlay.test.tsx` (import `providerTitle` from the overlay if not already imported; it is exported):

```tsx
describe('providerTitle', () => {
  it('labels the claude-code provider "Claude subscription"', () => {
    const title = providerTitle({ id: 'claude-code', name: 'Claude Code' } as OAuthProvider)
    expect(title).toBe('Claude subscription')
  })

  it('uses no em dash or en dash in the claude-code label', () => {
    const title = providerTitle({ id: 'claude-code', name: 'Claude Code' } as OAuthProvider)
    expect(title).not.toMatch(/[–—]/)
  })
})
```

If `OAuthProvider` is not already imported in the test file, add `import type { OAuthProvider } from '@/types/hermes'` (match the path used elsewhere in the suite).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --environment jsdom src/components/desktop-onboarding-overlay.test.tsx`
Expected: FAIL - title is the old long string, `toBe('Claude subscription')` does not match.

- [ ] **Step 3: Write minimal implementation**

In `desktop-onboarding-overlay.tsx`, change the `claude-code` entry in `PROVIDER_DISPLAY`:

```tsx
  'claude-code': { order: 2, title: 'Claude subscription' },
```

(Was `{ order: 6, title: 'Anthropic OAuth: Required Extra Usage Credits to Use Subscription' }`. Raising the order to 2 lifts it near the top of the sorted picker.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --environment jsdom src/components/desktop-onboarding-overlay.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/desktop-onboarding-overlay.tsx apps/desktop/src/components/desktop-onboarding-overlay.test.tsx
git commit -m "feat: rename claude-code provider label to Claude subscription"
```

---

## Task 2: Store - `initialApiKeyEnv` field + `startManualApiKey` action

**Files:**
- Modify: `apps/desktop/src/store/onboarding.ts` (interface ~line 57-84; `INITIAL` ~line 154; `startManualOnboarding` ~line 406; `startManualLocalEndpoint` ~line 425; `dismissFirstRunOnboarding` ~line 496; plus `closeManualOnboarding` and any full-state `set` in `completeDesktopOnboarding`)
- Modify: `apps/desktop/src/components/desktop-onboarding-overlay.test.tsx` (existing `$desktopOnboarding.set({...})` literals)
- Test: `apps/desktop/src/store/onboarding-provider-choice.test.ts` (create)

**Background:** `refreshOnboarding` calls `refreshProviders` in manual mode, which recomputes `mode` (to `oauth` when providers exist). So a post-first-run "Use OpenRouter" preselect cannot rely on `mode`; it needs a durable flag, exactly like the existing `localEndpoint` field. `startManualApiKey` mirrors `startManualLocalEndpoint` (line 425): it patches state and does NOT call `refreshProviders`, so nothing overwrites the intent.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/store/onboarding-provider-choice.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'

import {
  $desktopOnboarding,
  dismissFirstRunOnboarding,
  startManualApiKey,
  startManualOnboarding,
  startManualProviderOAuth
} from './onboarding'

describe('startManualApiKey', () => {
  beforeEach(() => {
    window.localStorage.clear()
    $desktopOnboarding.set({
      configured: true,
      firstRunSkipped: false,
      flow: { status: 'idle' },
      initialApiKeyEnv: null,
      localEndpoint: false,
      manual: false,
      mode: 'oauth',
      providers: null,
      reason: null,
      requested: false
    })
  })

  it('opens the manual key form pinned to the given env var', () => {
    startManualApiKey('OPENROUTER_API_KEY')

    const state = $desktopOnboarding.get()
    expect(state.manual).toBe(true)
    expect(state.requested).toBe(true)
    expect(state.localEndpoint).toBe(false)
    expect(state.initialApiKeyEnv).toBe('OPENROUTER_API_KEY')
    expect(state.mode).toBe('apikey')
  })

  it('is cleared when the user opens the full picker', () => {
    startManualApiKey('OPENROUTER_API_KEY')
    startManualOnboarding()

    expect($desktopOnboarding.get().initialApiKeyEnv).toBeNull()
  })

  it('is cleared when connecting a provider by id (e.g. claude-code)', () => {
    startManualApiKey('OPENROUTER_API_KEY')
    startManualProviderOAuth('claude-code')

    expect($desktopOnboarding.get().initialApiKeyEnv).toBeNull()
  })

  it('is cleared when the user chooses to decide later', () => {
    startManualApiKey('OPENROUTER_API_KEY')
    dismissFirstRunOnboarding()

    expect($desktopOnboarding.get().initialApiKeyEnv).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --environment jsdom src/store/onboarding-provider-choice.test.ts`
Expected: FAIL - `startManualApiKey` is not exported / `initialApiKeyEnv` does not exist.

- [ ] **Step 3: Write minimal implementation**

3a. Add the field to `DesktopOnboardingState` (after `localEndpoint: boolean` at line 83, inside the interface ending line 84):

```ts
  /** When set, the overlay opens the streamlined single-provider API-key form
   *  pinned to this env var (e.g. 'OPENROUTER_API_KEY'), instead of the OAuth
   *  picker. Durable like `localEndpoint`: a manual provider refresh flips
   *  `mode` back to 'oauth', so the key form keys off this flag, not `mode`.
   *  null = no preselect. */
  initialApiKeyEnv: null | string
```

3b. Add `initialApiKeyEnv: null` to the `INITIAL` constant (the full state literal at ~line 154).

3c. Add the `startManualApiKey` action. Place it directly after `startManualLocalEndpoint` (ends ~line 443). Model it on `startManualLocalEndpoint`:

```ts
// Open the streamlined API-key form pinned to one provider (e.g. OpenRouter)
// from an already-running app - the model picker's "Use OpenRouter" shortcut.
// Like startManualLocalEndpoint, it does NOT call refreshProviders, so the
// preselect survives the manual-mode mode flip; the durable initialApiKeyEnv
// flag is what the overlay reads.
export function startManualApiKey(initialEnvKey: string, reason: null | string = null) {
  clearPendingProviderOAuth()
  patch({
    flow: { status: 'idle' },
    initialApiKeyEnv: initialEnvKey,
    localEndpoint: false,
    manual: true,
    mode: 'apikey',
    reason: reason?.trim() || DEFAULT_MANUAL_ONBOARDING_REASON,
    requested: true
  })
}
```

Verify `clearPendingProviderOAuth`, `patch`, and `DEFAULT_MANUAL_ONBOARDING_REASON` are in scope in this module (they are: `clearPendingProviderOAuth` is exported and imported by the overlay; `DEFAULT_MANUAL_ONBOARDING_REASON` is defined at line 96). If `patch` is a private helper with a different name, use the same helper the neighboring actions use.

3d. Clear the field on the exits (add `initialApiKeyEnv: null` to the object passed to `patch(...)` in each):
- `startManualOnboarding` (line 406 patch)
- `startManualLocalEndpoint` (line 425 patch) - it is a different preselect, so clear the api-key one
- `dismissFirstRunOnboarding` (line 496 patch)
- `closeManualOnboarding` (read the function; add to its patch)
- `completeDesktopOnboarding` (read the function; if it does a full `.set({...})` literal it MUST include `initialApiKeyEnv: null` or typecheck fails; if it patches, add it for correctness)

Note: `startManualProviderOAuth` (line 445) already calls `startManualOnboarding`, so once 3d covers `startManualOnboarding` the claude-code path clears the field automatically. Confirm this by the passing test in Step 4.

3e. Fix existing full-state literals so typecheck passes: search the test suite for `$desktopOnboarding.set(` and add `initialApiKeyEnv: null` to each object literal.

```bash
grep -rn '\$desktopOnboarding.set(' apps/desktop/src
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --environment jsdom src/store/onboarding-provider-choice.test.ts`
Expected: PASS (all 4)

Then typecheck to confirm no locale/literal is missing the field:

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/store/onboarding.ts apps/desktop/src/store/onboarding-provider-choice.test.ts apps/desktop/src/components/desktop-onboarding-overlay.test.tsx
git commit -m "feat: add initialApiKeyEnv state + startManualApiKey onboarding action"
```

---

## Task 3: StartChoice first-run chooser + wire into Picker

**Files:**
- Create: `apps/desktop/src/components/desktop-onboarding-start-choice.tsx`
- Create: `apps/desktop/src/components/desktop-onboarding-start-choice.test.tsx`
- Modify: `apps/desktop/src/components/desktop-onboarding-overlay.tsx` (`Picker`, lines 431-460)
- Modify: `apps/desktop/src/components/desktop-onboarding-overlay.test.tsx` (the "OpenRouter-first run" block, lines 104-132)
- Modify i18n: add `onboarding.startChoice` block to en/ja/zh/zh-hant + types.ts

`StartChoice` is a pure presentational component (four callbacks, no store import) so it tests without a store harness. `Picker` renders it as the first-run gate; picking OpenRouter flips a local `pickedOpenRouter` state that reveals the existing streamlined key form. The Claude card, "other provider", and "choose later" call existing store actions.

- [ ] **Step 1: Write the failing test for StartChoice**

Create `apps/desktop/src/components/desktop-onboarding-start-choice.test.tsx`:

```tsx
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StartChoice } from './desktop-onboarding-start-choice'

function renderChoice() {
  const onUseOpenRouter = vi.fn()
  const onConnectClaude = vi.fn()
  const onOtherProvider = vi.fn()
  const onChooseLater = vi.fn()
  const rendered = render(
    <StartChoice
      onChooseLater={onChooseLater}
      onConnectClaude={onConnectClaude}
      onOtherProvider={onOtherProvider}
      onUseOpenRouter={onUseOpenRouter}
    />
  )

  return { onChooseLater, onConnectClaude, onOtherProvider, onUseOpenRouter, rendered }
}

describe('StartChoice', () => {
  afterEach(cleanup)

  it('renders both hero cards and both escapes', () => {
    const { rendered } = renderChoice()
    expect(rendered.getByText('Use OpenRouter')).toBeDefined()
    expect(rendered.getByText('Claude subscription')).toBeDefined()
    expect(rendered.getByText('Other provider')).toBeDefined()
    expect(rendered.getByText("I'll choose a provider later")).toBeDefined()
  })

  it('fires the right callback per control', () => {
    const { onChooseLater, onConnectClaude, onOtherProvider, onUseOpenRouter, rendered } = renderChoice()
    fireEvent.click(rendered.getByText('Use OpenRouter'))
    fireEvent.click(rendered.getByText('Claude subscription'))
    fireEvent.click(rendered.getByText('Other provider'))
    fireEvent.click(rendered.getByText("I'll choose a provider later"))
    expect(onUseOpenRouter).toHaveBeenCalledOnce()
    expect(onConnectClaude).toHaveBeenCalledOnce()
    expect(onOtherProvider).toHaveBeenCalledOnce()
    expect(onChooseLater).toHaveBeenCalledOnce()
  })
})
```

The test asserts on the English copy the app ships. If the test suite wraps components in an i18n provider, follow the existing pattern from `desktop-onboarding-overlay.test.tsx` (it renders without an explicit provider, so `useI18n` resolves the default locale - do the same here).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --environment jsdom src/components/desktop-onboarding-start-choice.test.tsx`
Expected: FAIL - module `./desktop-onboarding-start-choice` does not exist.

- [ ] **Step 3a: Add i18n keys**

Add an `onboarding.startChoice` block. In `apps/desktop/src/i18n/en.ts`, inside the `onboarding` object (near `chooseLater`, ~line 1563):

```ts
    startChoice: {
      claudeSubtitle: 'Use the Claude login already on this computer',
      claudeTitle: 'Claude subscription',
      openRouterSubtitle: 'One key, many models',
      openRouterTitle: 'Use OpenRouter',
      otherProvider: 'Other provider'
    },
```

Add the matching type to `apps/desktop/src/i18n/types.ts` inside the `onboarding` shape (~line 1215):

```ts
    startChoice: {
      claudeSubtitle: string
      claudeTitle: string
      openRouterSubtitle: string
      openRouterTitle: string
      otherProvider: string
    }
```

Add the same `startChoice` block (English fallback values, verbatim from en.ts) to the `onboarding` object in `ja.ts`, `zh.ts`, and `zh-hant.ts`. `npm run typecheck` in Step 5 fails if any locale is missing it.

- [ ] **Step 3b: Create StartChoice**

Create `apps/desktop/src/components/desktop-onboarding-start-choice.tsx`:

```tsx
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
```

Confirm `ChevronRight` is exported from `@/lib/icons` (the overlay imports it from there at line 17). If the `Button` variant/size names differ, match the overlay's usage (`variant="text"`, `size="xs"`).

- [ ] **Step 4: Run the StartChoice test to verify it passes**

Run: `npx vitest run --environment jsdom src/components/desktop-onboarding-start-choice.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire StartChoice into Picker + update the outdated overlay tests**

5a. In `desktop-onboarding-overlay.tsx`, import StartChoice and the store actions it needs at the callsite:

```tsx
import { StartChoice } from '@/components/desktop-onboarding-start-choice'
```

Ensure `startManualProviderOAuth` is imported from `@/store/onboarding` in this file (add it to the existing import block at lines 26-45 if absent). `setOnboardingMode` and `dismissFirstRunOnboarding` are already imported.

5b. Update `Picker` (lines 431-460). Replace the destructure and the first-run branch:

```tsx
export function Picker({ ctx }: { ctx: OnboardingContext }) {
  const { t } = useI18n()
  const { initialApiKeyEnv, localEndpoint, manual, mode, providers } = useStore($desktopOnboarding)
  const [showAll, setShowAll] = useState(readShowAll)
  const [pickedOpenRouter, setPickedOpenRouter] = useState(false)
  const ordered = useMemo(() => (providers ? sortProviders(providers) : []), [providers])
  const hasOauth = ordered.length > 0
  const apiKeyOptions = useApiKeyCatalog()

  const isFirstRun = mode === 'openrouter' && !manual && !localEndpoint

  // First-run start screen: two hero cards plus two escapes. Picking OpenRouter
  // flips a local gate to reveal the streamlined key form below. The Claude
  // card, "other provider", and "choose later" hand off to existing actions.
  if (isFirstRun && !pickedOpenRouter) {
    return (
      <StartChoice
        onChooseLater={() => dismissFirstRunOnboarding()}
        onConnectClaude={() => startManualProviderOAuth('claude-code')}
        onOtherProvider={() => setOnboardingMode('oauth')}
        onUseOpenRouter={() => setPickedOpenRouter(true)}
      />
    )
  }

  // Streamlined single-provider key entry. Reached two ways: (1) first run after
  // the user picks the OpenRouter card, (2) a manual "Use OpenRouter" shortcut
  // that set initialApiKeyEnv. A manual provider refresh flips `mode` to 'oauth',
  // so the manual path keys off the durable initialApiKeyEnv flag, never `mode`.
  if (isFirstRun || (manual && initialApiKeyEnv)) {
    return (
      <div className="grid gap-3">
        <ApiKeyForm
          backLabel={t.onboarding.useDifferentProvider}
          canGoBack={!manual}
          initialEnvKey={initialApiKeyEnv ?? 'OPENROUTER_API_KEY'}
          onBack={() => setPickedOpenRouter(false)}
          onSave={(envKey, value, name, apiKey) => saveOnboardingApiKey(envKey, value, name, ctx, apiKey)}
          options={apiKeyOptions}
          singleProvider
        />
        {manual ? null : (
          <div className="flex justify-center border-t border-(--ui-stroke-tertiary) pt-3">
            <ChooseLaterLink />
          </div>
        )}
      </div>
    )
  }
```

Leave the rest of `Picker` (the `localEndpoint || mode === 'apikey' || !hasOauth` branch and below) unchanged. Note `canGoBack={!manual}`: the manual OpenRouter shortcut has no back link (the overlay's own close affordance handles exit, matching how `localEndpoint` hides its back link); the first-run card path can go back to the chooser via `onBack`.

5c. Update the outdated "OpenRouter-first run" tests in `desktop-onboarding-overlay.test.tsx` (lines 104-132). They currently assert the picker lands DIRECTLY on the OpenRouter form. It now lands on the chooser first. Change them to:

```tsx
  it('first run shows the start chooser, then OpenRouter on demand', () => {
    $desktopOnboarding.set({
      configured: false,
      firstRunSkipped: false,
      flow: { status: 'idle' },
      initialApiKeyEnv: null,
      localEndpoint: false,
      manual: false,
      mode: 'openrouter',
      providers: [],
      reason: null,
      requested: false
    })

    const rendered = render(<Picker ctx={ctx} />)
    // Chooser first
    expect(rendered.getByText('Use OpenRouter')).toBeDefined()
    expect(rendered.getByText('Claude subscription')).toBeDefined()

    // Picking OpenRouter reveals the streamlined key form
    fireEvent.click(rendered.getByText('Use OpenRouter'))
    expect(rendered.getByText('OpenRouter')).toBeDefined()
    expect(rendered.getByText("I'll choose a provider later")).toBeDefined()
  })

  it('the Claude card starts the claude-code provider flow', () => {
    $desktopOnboarding.set({
      configured: false,
      firstRunSkipped: false,
      flow: { status: 'idle' },
      initialApiKeyEnv: null,
      localEndpoint: false,
      manual: false,
      mode: 'openrouter',
      providers: [],
      reason: null,
      requested: false
    })

    const rendered = render(<Picker ctx={ctx} />)
    fireEvent.click(rendered.getByText('Claude subscription'))

    const state = $desktopOnboarding.get()
    expect(state.manual).toBe(true)
    expect(state.requested).toBe(true)
  })
```

Keep the field set consistent with the state shape (include `initialApiKeyEnv: null`). If the existing tests import `fireEvent`, reuse it; otherwise add it to the `@testing-library/react` import. Match the exact heading text the streamlined form renders for OpenRouter - if the form shows a different string than the literal 'OpenRouter', assert on that actual string (read `ApiKeyForm` / the option label). The original test at line 104-132 already asserted the heading 'OpenRouter', so reuse whatever selector it used.

- [ ] **Step 6: Run the overlay + StartChoice tests**

Run: `npx vitest run --environment jsdom src/components/desktop-onboarding-overlay.test.tsx src/components/desktop-onboarding-start-choice.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/desktop-onboarding-start-choice.tsx apps/desktop/src/components/desktop-onboarding-start-choice.test.tsx apps/desktop/src/components/desktop-onboarding-overlay.tsx apps/desktop/src/components/desktop-onboarding-overlay.test.tsx apps/desktop/src/i18n/en.ts apps/desktop/src/i18n/ja.ts apps/desktop/src/i18n/zh.ts apps/desktop/src/i18n/zh-hant.ts apps/desktop/src/i18n/types.ts
git commit -m "feat: first-run start chooser for OpenRouter vs Claude subscription"
```

---

## Task 4: Model-picker empty state - two quick actions

**Files:**
- Modify: `apps/desktop/src/app/shell/model-menu-panel.tsx` (empty state, lines 183-196; import line 33)
- Create: `apps/desktop/src/app/shell/model-menu-panel.empty-actions.test.tsx`
- Modify i18n: add `shell.modelMenu.useOpenRouter` and `shell.modelMenu.connectClaude` to en/ja/zh/zh-hant + types.ts

Currently the empty state is one `DropdownMenuItem` ("Connect a model") calling `startManualOnboarding()`. Split it into two: "Use OpenRouter" (`startManualApiKey('OPENROUTER_API_KEY')`) and "Connect Claude subscription" (`startManualProviderOAuth('claude-code')`), each followed by `closeMenu()`. Extract a small exported `EmptyModelActions` so it is testable.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/app/shell/model-menu-panel.empty-actions.test.tsx`:

```tsx
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'

import { EmptyModelActions } from './model-menu-panel'

function renderActions() {
  const onConnectClaude = vi.fn()
  const onUseOpenRouter = vi.fn()
  const rendered = render(
    <DropdownMenu open>
      <DropdownMenuContent>
        <EmptyModelActions
          copy={{ connectClaude: 'Connect Claude subscription', useOpenRouter: 'Use OpenRouter' }}
          onConnectClaude={onConnectClaude}
          onUseOpenRouter={onUseOpenRouter}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return { onConnectClaude, onUseOpenRouter, rendered }
}

describe('EmptyModelActions', () => {
  afterEach(cleanup)

  it('renders both quick actions', () => {
    const { rendered } = renderActions()
    expect(rendered.getByText('Use OpenRouter')).toBeDefined()
    expect(rendered.getByText('Connect Claude subscription')).toBeDefined()
  })

  it('fires the matching handler on select', () => {
    const { onConnectClaude, onUseOpenRouter, rendered } = renderActions()
    fireEvent.click(rendered.getByText('Use OpenRouter'))
    expect(onUseOpenRouter).toHaveBeenCalledOnce()
    fireEvent.click(rendered.getByText('Connect Claude subscription'))
    expect(onConnectClaude).toHaveBeenCalledOnce()
  })
})
```

If Radix `DropdownMenuItem`'s `onSelect` does not fire on a plain `click` under jsdom, switch the interaction to `fireEvent.pointerUp(...)` then `fireEvent.click(...)`, or assert via keyboard (`fireEvent.keyDown(item, { key: 'Enter' })`). The item must actually be exercised - do not weaken the test to a render-only check.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --environment jsdom src/app/shell/model-menu-panel.empty-actions.test.tsx`
Expected: FAIL - `EmptyModelActions` is not exported.

- [ ] **Step 3a: Add i18n keys**

In `apps/desktop/src/i18n/en.ts`, inside `shell.modelMenu` (near `connectModel`, ~line 1658):

```ts
      connectClaude: 'Connect Claude subscription',
      useOpenRouter: 'Use OpenRouter',
```

Add the matching `string` types to `shell.modelMenu` in `types.ts` (~line 1297), and the same two keys to `shell.modelMenu` in `ja.ts`, `zh.ts`, `zh-hant.ts` (English fallback values). Keep `connectModel` - it may still be referenced elsewhere; removing it is out of scope.

- [ ] **Step 3b: Extract EmptyModelActions and use it**

In `model-menu-panel.tsx`, extend the store import (line 33):

```tsx
import { startManualApiKey, startManualOnboarding, startManualProviderOAuth } from '@/store/onboarding'
```

(Keep `startManualOnboarding` if it is still used elsewhere in the file; if the empty state was its only use, drop it from the import to avoid an unused-symbol lint error - check with a search.)

Add the exported component (near the other module-level components in the file):

```tsx
export function EmptyModelActions({
  copy,
  onConnectClaude,
  onUseOpenRouter
}: {
  copy: { connectClaude: string; useOpenRouter: string }
  onConnectClaude: () => void
  onUseOpenRouter: () => void
}) {
  return (
    <>
      <DropdownMenuItem className={dropdownMenuRow} onSelect={onUseOpenRouter}>
        <Codicon name="add" size="0.75rem" />
        {copy.useOpenRouter}
      </DropdownMenuItem>
      <DropdownMenuItem className={dropdownMenuRow} onSelect={onConnectClaude}>
        <Codicon name="add" size="0.75rem" />
        {copy.connectClaude}
      </DropdownMenuItem>
    </>
  )
}
```

Replace the empty-state branch (lines 183-196, the `) : (` ... `)` that currently renders the single "Connect a model" item):

```tsx
        ) : (
          // No authenticated provider at all - offer the two quick paths
          // instead of dead-ending. Mirrors the first-run start chooser.
          <EmptyModelActions
            copy={{ connectClaude: copy.connectClaude, useOpenRouter: copy.useOpenRouter }}
            onConnectClaude={() => {
              startManualProviderOAuth('claude-code')
              closeMenu()
            }}
            onUseOpenRouter={() => {
              startManualApiKey('OPENROUTER_API_KEY')
              closeMenu()
            }}
          />
        )
```

Here `copy` is the already-bound `t.shell.modelMenu` (line 64).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --environment jsdom src/app/shell/model-menu-panel.empty-actions.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/app/shell/model-menu-panel.tsx apps/desktop/src/app/shell/model-menu-panel.empty-actions.test.tsx apps/desktop/src/i18n/en.ts apps/desktop/src/i18n/ja.ts apps/desktop/src/i18n/zh.ts apps/desktop/src/i18n/zh-hant.ts apps/desktop/src/i18n/types.ts
git commit -m "feat: split model-picker empty state into OpenRouter + Claude quick actions"
```

---

## Task 5: Settings > Models - "Claude subscription" connect row

**Files:**
- Modify: `apps/desktop/src/app/settings/model-settings.tsx` (icons import line 19; render after `</section>` at line 543)
- Create: `apps/desktop/src/app/settings/claude-subscription-row.test.tsx`
- Modify i18n: add `settings.model.claudeSubscription` block to en/ja/zh/zh-hant + types.ts

Add a first-class, always-visible "Claude subscription" row under the main-model picker. It reads the `claude-code` provider from the already-fetched `providers` array: Connected indicator when ready, a Connect button (`startManualProviderOAuth('claude-code')`) otherwise. `isProviderReady(undefined)` returns false, so the lookup is defensive when the row is absent. No disconnect button (Phase B).

**Slug note:** The Connect action passes the literal `'claude-code'` - the same id the onboarding path already uses successfully. The status lookup keys off `provider.slug === 'claude-code'`. The model-options slug and the onboarding provider id share one registry (Settings' own `startProviderSetup` passes `selectedProviderRow.slug` straight into `startManualProviderOAuth`), so this is consistent. At implementation time, confirm the slug by inspecting a live `getGlobalModelOptions()` response or the backend `_OAUTH_PROVIDER_CATALOG`; if the Claude subscription provider surfaces under a different slug, set `CLAUDE_CODE_SLUG` to that value (the Connect literal stays `'claude-code'` since that is what onboarding accepts).

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/app/settings/claude-subscription-row.test.tsx`:

```tsx
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelOptionProvider } from '@/types/hermes'

import { ClaudeSubscriptionRow } from './model-settings'

const startManualProviderOAuth = vi.hoisted(() => vi.fn())
vi.mock('@/store/onboarding', async importOriginal => ({
  ...(await importOriginal<typeof import('@/store/onboarding')>()),
  startManualProviderOAuth
}))

function provider(overrides: Partial<ModelOptionProvider>): ModelOptionProvider {
  return { slug: 'claude-code', name: 'Claude Code', authenticated: true, models: ['sonnet'], ...overrides } as ModelOptionProvider
}

describe('ClaudeSubscriptionRow', () => {
  afterEach(() => {
    cleanup()
    startManualProviderOAuth.mockClear()
  })

  it('shows Connected when the claude-code provider is ready', () => {
    const rendered = render(<ClaudeSubscriptionRow providers={[provider({})]} />)
    expect(rendered.getByText('Connected')).toBeDefined()
    expect(rendered.queryByText('Connect')).toBeNull()
  })

  it('shows Connect when the provider is missing or unauthenticated', () => {
    const rendered = render(<ClaudeSubscriptionRow providers={[]} />)
    expect(rendered.getByText('Connect')).toBeDefined()
  })

  it('Connect starts the claude-code provider flow', () => {
    const rendered = render(<ClaudeSubscriptionRow providers={[]} />)
    fireEvent.click(rendered.getByText('Connect'))
    expect(startManualProviderOAuth).toHaveBeenCalledWith('claude-code')
  })
})
```

Match the mock path/style to any existing settings test in the repo. If `ModelOptionProvider` requires more non-optional fields than shown, add them to the `provider` factory so the cast is unnecessary; otherwise the `as ModelOptionProvider` cast keeps the fixture minimal.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --environment jsdom src/app/settings/claude-subscription-row.test.tsx`
Expected: FAIL - `ClaudeSubscriptionRow` is not exported.

- [ ] **Step 3a: Add i18n keys**

In `apps/desktop/src/i18n/en.ts`, inside `settings.model` (~line 536):

```ts
    claudeSubscription: {
      connect: 'Connect',
      connected: 'Connected',
      connectedHint: 'Basecamp is using your Claude login on this computer.',
      disconnectedHint: 'Use your existing Claude login instead of an API key.',
      title: 'Claude subscription'
    },
```

Add the matching type to `settings.model` in `types.ts`, and the same block (English fallback) to `settings.model` in `ja.ts`, `zh.ts`, `zh-hant.ts`.

- [ ] **Step 3b: Implement ClaudeSubscriptionRow and render it**

Add `Check` to the icons import in `model-settings.tsx` (line 19):

```tsx
import { AlertTriangle, Check, Cpu, Loader2 } from '@/lib/icons'
```

Add the constant and component (place near the top-level helpers, after `isProviderReady`):

```tsx
const CLAUDE_CODE_SLUG = 'claude-code'

// First-class connect row for the Claude subscription (the external claude-code
// provider). Connect reuses the existing onboarding flow; no in-app OAuth and
// no disconnect that could touch ~/.claude (non-destructive disconnect is a
// separate backend follow-on).
export function ClaudeSubscriptionRow({ providers }: { providers: ModelOptionProvider[] }) {
  const { t } = useI18n()
  const c = t.settings.model.claudeSubscription
  const row = providers.find(p => p.slug === CLAUDE_CODE_SLUG)
  const connected = isProviderReady(row)

  return (
    <div className="flex items-center justify-between gap-3 rounded-[6px] border border-(--ui-stroke-tertiary) px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{c.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{connected ? c.connectedHint : c.disconnectedHint}</p>
      </div>
      {connected ? (
        <span className="inline-flex shrink-0 items-center gap-1 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          <Check className="size-3" />
          {c.connected}
        </span>
      ) : (
        <Button onClick={() => startManualProviderOAuth(CLAUDE_CODE_SLUG)} size="sm" variant="textStrong">
          {c.connect}
        </Button>
      )}
    </div>
  )
}
```

`startManualProviderOAuth` is already imported (line 22). `isProviderReady`, `Button`, `useI18n`, and `ModelOptionProvider` are all already in scope.

Render it as its own section between the main-model section and the auxiliary section (after `</section>` at line 543, before the auxiliary `<section>` at line 545):

```tsx
      <section>
        <ClaudeSubscriptionRow providers={providers} />
      </section>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --environment jsdom src/app/settings/claude-subscription-row.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/app/settings/model-settings.tsx apps/desktop/src/app/settings/claude-subscription-row.test.tsx apps/desktop/src/i18n/en.ts apps/desktop/src/i18n/ja.ts apps/desktop/src/i18n/zh.ts apps/desktop/src/i18n/zh-hant.ts apps/desktop/src/i18n/types.ts
git commit -m "feat: add Claude subscription connect row to Settings > Models"
```

---

## Task 6: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full UI unit suite**

Run: `npx vitest run --environment jsdom src/`
Expected: PASS - no regressions in onboarding, model-menu, or settings suites.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS - proves every locale (en/ja/zh/zh-hant) has every new key and every state literal has `initialApiKeyEnv`.

- [ ] **Step 3: If anything fails**

Fix at the source (do not weaken tests). Re-run Steps 1-2 until both are green. Common causes: a locale file missing a new key (typecheck points to it); a state literal missing `initialApiKeyEnv`; a Radix `onSelect` interaction needing a different fireEvent under jsdom.

- [ ] **Step 4: Final commit (only if fixes were needed)**

```bash
git add -A -- apps/desktop/src
git commit -m "test: green vitest + typecheck for provider-choice"
```

Note: scope the final `git add` to `apps/desktop/src` (as shown) so unrelated dirty files in the working tree are never staged.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-02-basecamp-provider-choice-design.md`):
- Decision 1 (reuse existing Claude login, no new OAuth): Tasks 3, 4, 5 all route through `startManualProviderOAuth('claude-code')` - the existing external flow. No new auth code.
- Decision 2 (start screen: two hero cards + two escapes): Task 3 (`StartChoice`).
- Decision 3 (canonical home = Settings > Models, Connect / Connected): Task 5 (`ClaudeSubscriptionRow`). Disconnect explicitly deferred to Phase B (documented in Scope).
- Decision 4 (model-picker empty state = two quick actions): Task 4.
- Decision 5 (copy "Claude subscription", no em/en dash): Task 1 rename + the em/en-dash guard test; all new strings use hyphens.
- Testing section: unit tests for start screen (Task 3), empty state (Task 4), Settings row (Task 5), `providerTitle` copy + dash guard (Task 1); regression via full suite + typecheck (Task 6).

**Placeholder scan:** every step has concrete code or an exact command. The one deliberate at-implementation confirmation is the `claude-code` slug in Task 5, with a fallback instruction and a defensive lookup - not a placeholder.

**Type consistency:** `initialApiKeyEnv: null | string` is used identically in the interface, `INITIAL`, `startManualApiKey`, and every state literal. `startManualApiKey(initialEnvKey: string, reason?)` is called as `startManualApiKey('OPENROUTER_API_KEY')` in Task 4. `EmptyModelActions` prop shape (`copy: { connectClaude; useOpenRouter }`, two callbacks) matches its callsite and test. `ClaudeSubscriptionRow({ providers })` matches its callsite and test. `StartChoice` four-callback prop shape matches Picker's usage and the test.

**Out of scope (Phase B, separate cycle):** non-destructive disconnect of the external `claude-code` provider (backend Python that clears only Basecamp's selection, never `~/.claude/.credentials.json`).
