# Basecamp — Architecture

Basecamp is a desktop AI-agent app: a reskinned, upstream-mergeable build of the
Hermes Agent. The Electron app is the **product shell** — it does not contain the
agent engine. On first launch it installs the Hermes backend on the machine (or
connects to a remote hosted one), then drives that backend over a WebSocket.

This doc is **diagram-first, model-backed** (C4) plus one deployment view. Keep it
updated **in the same PR** as any change to the boxes or arrows. A stale diagram is
worse than none. The "why" behind these structures lives in [`../../docs/adr/`](../../docs/adr/).

- **Repo:** `33labs-xyz/hermes-agent-basecamp`
- **Product (shell) code:** `apps/desktop/` (this folder)
- **Backend (engine) code:** `gateway/`, `agent/`, `hermes/`, `hermes_state.py` (repo root) — ships as the installed Hermes Agent, NOT inside the `.app`

---

## Level 0 — Deployment / distribution

Where Basecamp comes from and how it gets running. This answers "doesn't it start
at GitHub?" — yes, the **artifact** starts at GitHub; the **running app** starts
locally and then provisions or connects to its backend.

```mermaid
flowchart TD
  dev["Developer<br/>(local build + electron-builder)"]
  rel["GitHub Releases<br/>33labs-xyz/hermes-agent-basecamp<br/>(.dmg / .exe + update feed)"]
  dl["Download page / direct link"]
  app["Basecamp.app installed<br/>(Electron shell only)"]

  subgraph firstrun["First launch (one time)"]
    boot["bootstrap-runner.cjs<br/>downloads install.sh / install.ps1"]
    home["HERMES_HOME/hermes-agent/<br/>python venv + node + gateway/ + agent/ + state.db"]
  end

  remote["Remote hosted gateway<br/>(optional, instead of local install)"]

  dev -->|publish| rel
  rel -->|user downloads| dl
  dl -->|install| app
  app -->|first run, local mode| boot
  boot -->|installs engine| home
  app -.->|or: remote mode, OAuth| remote
  rel -->|electron-updater checks| app
```

**Notes:**

- The `.app` bundle ships **only the Electron shell**: renderer UI (`dist/**`),
  main process (`electron/**`), assets, icon, prebuilt native deps. It does NOT
  contain `gateway/`, `agent/`, or `state.db` (see electron-builder `files` /
  `extraResources` in `package.json`).
- **Local mode:** first launch runs `bootstrap-runner.cjs`, which downloads and
  executes `install.sh` / `install.ps1` to install the Hermes engine into
  `HERMES_HOME` (its own python venv + node). The engine — and `state.db` — live
  there, on disk, beside the app but not inside it.
- **Remote mode:** instead of a local engine, the app can connect to a hosted
  gateway and authenticate over OAuth (see Level 2).
- GitHub Releases is both the **origin** of the app and its **auto-update feed**.

---

## Level 1 — System context

Who and what Basecamp talks to. Readable by anyone.

```mermaid
C4Context
  title Basecamp — system context

  Person(user, "Operator", "Runs the desktop app, chats with the agent")

  System(basecamp, "Basecamp", "Desktop AI-agent app (Electron shell + Hermes backend)")

  System_Ext(gh, "GitHub Releases", "App download + auto-update feed (electron-updater)")
  System_Ext(remote, "Remote hosted gateway", "Optional cloud Hermes backend (OAuth)")
  System_Ext(llm, "LLM providers", "Anthropic, OpenAI, local LLM")
  System_Ext(mcp, "MCP servers + tools", "Skills, plugins, external MCP integrations")
  System_Ext(studio, "Media APIs", "MUAPI / higgsfield image + video generation")

  Rel(user, basecamp, "Chats, runs tasks")
  Rel(basecamp, gh, "Downloads app + checks updates", "HTTPS")
  Rel(basecamp, remote, "Connects (remote mode)", "WSS + OAuth")
  Rel(basecamp, llm, "Prompts / completions", "HTTPS")
  Rel(basecamp, mcp, "Tool calls", "stdio / HTTP")
  Rel(basecamp, studio, "Generation jobs", "HTTPS")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

---

## Level 2 — Containers

The runnable pieces. The key boundary: the **`.app` bundle is just the shell**;
the **backend is a separate process**, either installed at `HERMES_HOME` or hosted
remotely. The dashed boundary marks what ships inside the `.app`.

```mermaid
C4Container
  title Basecamp — containers

  Person(user, "Operator")

  Container_Boundary(app, "Basecamp.app bundle (shell only)") {
    Container(electron, "Electron main", "Node / main.cjs", "Window, lifecycle, dock icon, auto-updater, first-launch bootstrap, spawns + supervises local backend")
    Container(renderer, "Renderer UI", "React + Vite + TS + Tailwind", "Chat, Projects, Council, Free chat, Studio, Settings (apps/desktop/src)")
  }

  Container_Boundary(backend, "Hermes backend — HERMES_HOME install OR remote host") {
    Container(gateway, "Agent gateway", "Python + aiohttp", "Serves /ws; local mode auths with per-launch dashboard token, remote mode with OAuth ticket (gateway/)")
    Container(agentcore, "Agent core", "Python", "Tool dispatch, sessions, providers (agent/, hermes/)")
    ContainerDb(state, "State", "SQLite WAL — state.db", "Sessions, chat_groups/Projects, cron jobs (hermes_state.py)")
  }

  System_Ext(gh, "GitHub Releases")
  System_Ext(llm, "LLM providers")
  System_Ext(mcp, "MCP servers + tools")
  System_Ext(studio, "Media APIs (MUAPI / higgsfield)")

  Rel(user, renderer, "Uses")
  Rel(electron, renderer, "Loads", "BrowserWindow")
  Rel(electron, gateway, "Spawns + supervises (local mode only)", "child process")
  Rel(electron, gh, "Auto-update", "HTTPS")
  Rel(renderer, gateway, "Streams chat + REST", "WebSocket /ws (dashboard token | OAuth ticket)")
  Rel(gateway, agentcore, "Drives the agent loop")
  Rel(agentcore, state, "Reads / writes", "sqlite3")
  Rel(agentcore, llm, "Completions", "HTTPS")
  Rel(agentcore, mcp, "Tool calls", "stdio / HTTP")
  Rel(renderer, studio, "Generation jobs", "HTTPS")

  UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")
```

**Notes that the boxes can't hold:**

- **Two backend modes, one renderer.** The UI talks `/ws` either way; only the
  connection target + auth differ:
  - **Local mode:** Electron spawns the gateway installed at `HERMES_HOME`, bound
    to loopback, authed with a per-launch **dashboard token**. Not internet-exposed.
  - **Remote mode:** the renderer connects to a hosted gateway over WSS and auths
    with an **OAuth ticket** minted at `POST /api/auth/ws-ticket`
    (`apps/desktop/electron/connection-config.cjs`). Settings → Gateway controls this.
- **The `.app` does not contain the engine.** `gateway/`, `agent/`, `hermes/`,
  `state.db` are installed at `HERMES_HOME` on first launch (local mode) or live on
  the remote host. The bundle ships shell + native deps + installer stamp only.
- **`state.db` is local SQLite (WAL).** Projects (chat_groups), sessions, and cron
  persist there — in `HERMES_HOME` (local) or on the host (remote), never a cloud DB
  owned by the app itself.
- **Renderer surfaces (tabs):** Chat, Projects, Council, Free chat, Studio,
  Scheduled, Settings — each a folder under `apps/desktop/src/app/`.

---

## Level 3 — Components

Skip by default. Draw a component diagram **only** for a subsystem hairy enough to
need it — e.g. the first-launch bootstrap/install flow, the local-vs-remote
connection + auth path, or the Projects/chat_groups context-injection path. Add it
as `ARCHITECTURE-<subsystem>.md` next to this file and link it here.

- _(none yet)_

---

## Level 4 — Code

Don't. If you ever need class-level detail, generate it from source on demand
rather than hand-maintaining it.

---

## Maintenance rules

1. Touch the architecture → touch this file **in the same PR**.
2. Record non-obvious decisions as an ADR in [`../../docs/adr/`](../../docs/adr/)
   and link it from the code it governs.
3. Match detail to audience: Deployment + Context for anyone, Container for
   engineers, Component only where there is real confusion.
4. The bundle/backend boundary is the thing reviewers get wrong — keep the dashed
   `.app` boundary honest. If something new ships inside the `.app`, it goes inside
   the shell box; if it installs to `HERMES_HOME` or runs remote, it goes in the
   backend box.
