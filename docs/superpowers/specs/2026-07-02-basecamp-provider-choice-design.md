# Basecamp Provider Choice (OpenRouter vs Claude Subscription) Design

**Date:** 2026-07-02
**Status:** Approved (design locked). Ready for implementation plan.
**Repo / branch:** `basecamp-app` on `feat/studio-integration`
**Task:** #38 (onboarding + settings provider choice)

## Goal

Make it easy, both at first run and later in Settings, for a person to either use
OpenRouter or connect an existing Claude subscription. No new authentication code:
the Hermes backend already exposes a `claude-code` provider that reads the user's
existing Claude login. This work is discoverability and surfacing, not plumbing.

## Background: how it works today

First run currently pushes OpenRouter front and center. The `claude-code` provider
exists but is buried in the full OAuth picker under an unusable label.

Confirmed code anchors (all paths relative to `basecamp-app/`):

Desktop (`apps/desktop/src/`):
- `store/onboarding.ts`
  - `OnboardingMode = 'apikey' | 'oauth' | 'openrouter'` (line 27)
  - `startManualOnboarding()` (line 406)
  - `startManualProviderOAuth(providerId)` (line 445, calls `startManualOnboarding`)
  - `dismissFirstRunOnboarding()` (line 496) is the "choose later" escape
  - `refreshOnboarding(ctx)` (line 506)
- `components/desktop-onboarding-overlay.tsx`
  - `PROVIDER_DISPLAY` map (line 169); `claude-code` entry (line 178) currently titled
    `'Anthropic OAuth: Required Extra Usage Credits to Use Subscription'`
  - `providerTitle()` (line 183), `orderOf()` (line 184)
  - "I'll choose a provider later" handling (lines 277, 541)
  - "Use a different provider" back link to the full picker (lines 440, 671)
- `app/shell/model-menu-panel.tsx` empty state calls `startManualOnboarding()` (line 189)
- `app/settings/model-settings.tsx` `needsSetup` (line 173), `startManualProviderOAuth(slug)`
  (line 302), setup render branches (lines 438, 493)
- `app/settings/providers-settings.tsx` `OAuthPicker` (line 106), `startManualProviderOAuth(p.id)`
  (line 128), render (line 399)
- `types/hermes.ts` `OAuthProvider` (lines 48-60), `ModelOptionProvider.auth_type` (lines 226-228),
  `listOAuthProviders()` (line 389)

Backend (repo root):
- `hermes_cli/web_server.py`
  - `_claude_code_only_status()` (line 5135) reports connected state from the existing login
  - `_OAUTH_PROVIDER_CATALOG` `claude-code` entry (lines 5227-5232): `flow: "external"` (5229),
    `cli_command: "claude setup-token"` (5230), `docs_url` (5231)
- `agent/anthropic_adapter.py`
  - `read_claude_code_credentials()` (line 917) reads `~/.claude/.credentials.json` (and
    `~/.claude.json`); keychain variant `_read_claude_code_credentials_from_keychain()` (line 859)

## Locked design decisions

1. **Connect mechanism = reuse the existing Claude login. No new OAuth.**
   The backend `claude-code` provider already detects the on-machine Claude login and,
   when absent, surfaces the sanctioned `claude setup-token` command. We surface that,
   we do not build an in-app browser OAuth.

2. **Start screen (first run) = two hero cards plus two visible escapes.**
   Cards: "Use OpenRouter" and "Claude subscription" (equal weight). Below them, two
   visible affordances: "Other provider" (opens the full picker) and "Choose later"
   (dismisses first-run onboarding, lands the user in the app).

3. **Canonical home for connect/disconnect = Settings > Models.**
   A first-class "Claude subscription" provider row: "Connect" when disconnected,
   "Connected" plus "Disconnect" when connected. This is what the user asked for
   ("connect the Claude subscription in settings where the model picker is").

4. **Model-picker empty state = secondary quick shortcut.**
   Only when no model is connected, the top model-picker menu splits its single
   "Connect a model" action into two quick actions: "Use OpenRouter" and
   "Connect Claude subscription". Once a model is connected, the menu is unchanged.

5. **Copy: call it "Claude subscription" everywhere; button reads "Connect Claude
   subscription".** No em dashes or en dashes in any shipped string (hyphens only).

## Detailed design

### Start screen (first run)

Render two hero cards in the first-run overlay:
- "Use OpenRouter" keeps today's behavior: preselect the OpenRouter API key form.
- "Claude subscription" drives the `claude-code` provider: set onboarding mode to
  `'oauth'` and call `startManualProviderOAuth('claude-code')`, which routes into the
  existing external flow.

Below the cards, two always-visible controls:
- "Other provider" opens the full OAuth picker (the existing "use a different provider"
  path).
- "Choose later" calls `dismissFirstRunOnboarding()` (the existing escape).

No provider gets stuck: four exits (OpenRouter, Claude, other, skip).

### Connect mechanism

The `claude-code` provider status already reflects whether the on-machine Claude login
exists (`_claude_code_only_status` via `read_claude_code_credentials`).

- Already logged in: status reports connected. "Connect" is effectively confirm-and-go,
  no extra step.
- Not logged in: the existing external flow surfaces the `claude setup-token` command
  (copy to clipboard) and a paste field for the returned token. This is Anthropic's
  sanctioned path, so we do not fight it.

We reuse the existing external ("cli_command") onboarding UI. No new backend auth code.

### Settings > Models (canonical home)

Show a "Claude subscription" provider row alongside the other providers:
- Disconnected: a "Connect" button wired to `startManualProviderOAuth('claude-code')`.
- Connected: a "Connected" indicator plus a "Disconnect" button.

**Disconnect must not delete the user's global Claude login.** The `~/.claude`
credentials belong to the user's Claude Code install, not to Basecamp. "Disconnect"
means stop using the Claude subscription inside Basecamp (clear it from Hermes' active
provider selection / stored auth), and never touches `~/.claude/.credentials.json`.
If no such "forget provider selection" action exists for an external provider, add a
minimal backend action that clears only Basecamp's selection, leaving the on-machine
Claude login intact.

### Model-picker empty state (secondary)

In `app/shell/model-menu-panel.tsx`, when the empty state renders (no model connected),
replace the single "Connect a model" action with two quick actions:
- "Use OpenRouter" -> onboarding preselect OpenRouter.
- "Connect Claude subscription" -> `startManualProviderOAuth('claude-code')`.

Both route into the same onboarding paths used elsewhere. When a model is connected,
the menu keeps its current shape.

### Copy and labels

- Rename `PROVIDER_DISPLAY['claude-code'].title` from the current long string to
  "Claude subscription". Consider raising its `order` so it sits near the top of the
  picker instead of last.
- Any other user-visible string that references the old label updates to
  "Claude subscription" / "Connect Claude subscription".
- Enforce the no em dash / no en dash rule on every new or edited string.

## What we are NOT building

- No in-app browser OAuth for Claude. Deferred; can revisit if testers demand pure
  one-click in-app login.
- No change to how OpenRouter onboarding works beyond presenting it as one of two
  equal cards.
- No deletion or mutation of the user's global `~/.claude` credentials.

## Error handling

- Backend unreachable while reading provider status: the card and the Settings row show
  a neutral disconnected state; "Connect" retries the flow. No crash, no false
  "connected".
- `claude setup-token` not available (CLI not installed): the external flow shows the
  command plus the existing `docs_url` so the user can install Claude Code, then retry.
- Bad or expired pasted token: surface the backend error inline in the paste field;
  the user can paste again. Do not advance to "connected".
- "Choose later" is always safe and reversible: the user can connect any provider later
  from Settings.

## Testing

- Unit (vitest, `apps/desktop`): start-screen renders both hero cards plus "Other
  provider" and "Choose later"; the Claude card calls `startManualProviderOAuth('claude-code')`;
  "Choose later" calls `dismissFirstRunOnboarding()`.
- Unit: model-picker empty state renders two quick actions only when no model is
  connected; each triggers the correct onboarding path.
- Unit: Settings > Models shows "Claude subscription" with the correct Connect vs
  Connected+Disconnect state driven by provider status; Disconnect clears only Basecamp
  selection.
- Copy test: `providerTitle` for `claude-code` returns "Claude subscription"; a guard
  asserts no em dash or en dash in the new strings.
- Regression: existing onboarding and model-picker vitest suites stay green; typecheck
  clean.

## Open points for the plan

- Confirm the exact existing external-flow UI hooks (the `external_pending` render in
  `desktop-onboarding-overlay.tsx`) so the Claude card and the Settings Connect button
  both land in the same screen.
- Confirm whether a "forget external provider selection" backend action already exists;
  if not, the plan adds a minimal one that never touches `~/.claude`.
