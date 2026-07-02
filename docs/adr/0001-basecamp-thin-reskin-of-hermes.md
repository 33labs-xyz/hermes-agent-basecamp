# 0001. Basecamp is a thin reskin of Hermes

- **Status:** Accepted
- **Date:** 2026-06-23

## Context

Basecamp ships as a desktop AI-agent app. The whole engine already exists as the
upstream Hermes Agent (agent loop, aiohttp gateway, SQLite state, providers,
MCP tooling, Electron shell). We are a solo operator, not a team forking a
product. Two needs are in tension:

1. We want our own brand, palette, app identity, and a small set of product
   surfaces (Projects, Council, Free chat, Studio, Scheduled).
2. We want to keep pulling upstream Hermes improvements cleanly for a long time,
   without resolving large merge conflicts every release.

A hard fork that rewrites internals would satisfy (1) and destroy (2).

## Decision

We will treat Basecamp as a **thin, upstream-mergeable reskin** of Hermes, not a
divergent fork:

- Rebrand only at the edges: app name, `productName`, `appId`
  (`xyz.getnifty.basecamp`), icons, brand-mark, i18n strings, window/About text,
  and a Basecamp theme added through the **existing** theme system.
- Add product surfaces as **additive** modules under `apps/desktop/src/app/`
  rather than rewriting core flows.
- Keep the Python engine (`gateway/`, `agent/`, `hermes/`, `hermes_state.py`)
  as close to upstream as possible; prefer new files over edits to shared ones.
- The desktop app is a **shell only**: it installs the Hermes backend into
  `HERMES_HOME` on first launch (or connects to a remote hosted gateway), then
  drives it over `/ws`. Local mode auths with a per-launch dashboard token over
  loopback; remote mode auths with an OAuth ticket. State stays in local SQLite
  (`state.db`, WAL) at `HERMES_HOME` (or on the remote host).
- Distribute and self-update via electron-updater against GitHub Releases on the
  fork `33labs-xyz/hermes-agent-basecamp`.

## Consequences

**Easier:**
- Upstream Hermes changes keep merging with minimal conflict.
- The architecture stays understandable: a thin shell bundle plus a separately
  installed (or remote) Hermes backend that holds the state file (see
  [`../../apps/desktop/ARCHITECTURE.md`](../../apps/desktop/ARCHITECTURE.md)).

**Harder / watch:**
- Every new feature must be evaluated for "additive vs. invasive." Invasive edits
  to shared files are merge debt — flag them in review.
- Brand strings can leak back in from upstream; renames need a periodic sweep.
- Renaming the app touches signing/notarization identity; release config is part
  of this decision's surface.

**Now maintained by us:**
- The reskin layer (theme, brand assets, i18n overrides) and the additive product
  surfaces.

## Links

- Architecture: [`../../apps/desktop/ARCHITECTURE.md`](../../apps/desktop/ARCHITECTURE.md)
- Brand + build identity: `apps/desktop/package.json`, `apps/desktop/assets/`
- Auto-update: `apps/desktop/electron/auto-updater.cjs`
- Local backend wiring: `apps/desktop/electron/connection-config.cjs`, `gateway/run.py`
