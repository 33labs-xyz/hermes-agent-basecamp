# Claude (subscription) provider

## What it is

Basecamp can run turns through your own Claude Code login instead of a
pay-per-token API key. The provider id is `claude-cli` and it appears in the
model picker as "Claude (subscription)".

When selected, Basecamp drives the locally installed `claude` CLI in headless
mode and streams its output back into the normal chat and tool UI. Turns bill
against your Claude subscription (Pro or Max), not an API balance.

Tool parity with the API providers is full: Basecamp's native tools (web
search, skills, MCP servers) all work inside a subscription turn, wired in over
a per-turn stdio MCP bridge. From the chat, you cannot tell the engine is a
local CLI.

## Requirements (per user)

- An active Claude subscription (Claude Pro or Claude Max) on your Anthropic
  account.
- Claude Code installed locally and signed in: run `claude login` once in a
  terminal and complete the browser sign-in.
- Claude Code version 2.1.0 or newer. Check with `claude --version`.
- Desktop only. The provider shells out to a local binary, so it is not
  available in any hosted or web context.

In the app: open the model picker, choose "Claude (subscription)", pick a model
(for example sonnet), and prompt as usual. If the provider is unconfigured, its
row in Settings shows "Install Claude Code and run: claude login" with a copy
button for the command and a link to https://claude.com/claude-code.

## Protocol and version pin

- The provider speaks the CLI's stream-json contract, which is pinned to Claude
  Code 2.1.0 and newer.
- The entire stream-json parse and serialize contract lives in one file:
  `agent/claude_cli_client.py`. If a future CLI release changes the stream
  shape, that is the single place to update. Nothing else in the codebase
  parses CLI output.
- Tools are wired in per turn: Basecamp mints an ephemeral bridge token, starts
  a stdio MCP bridge, runs the turn, then revokes the token and tears the bridge
  down. No tools are exposed to the CLI without an active bridge.

## Known limits (v1)

- Desktop only (see requirements).
- Vision and image attachments are off in v1 (`supports_vision = False`). Text
  and tools only. This is a follow-up candidate.
- Quota is shared with your normal Claude Code usage. A subscription turn in
  Basecamp counts against the same limits as running `claude` yourself, so heavy
  use can hit your plan's usage cap.
- The CLI's own built-in tools (filesystem, bash on your machine) are
  intentionally disabled (`--tools ""`). Basecamp exposes only its own bridged
  tools. Claude-Code-native agent mode (files and bash on the user machine) is
  out of scope for v1 and would need a separate permission-approval design.
- Policy risk: running a subscription through an automated client is subject to
  Anthropic's terms for Claude Code and for your Claude subscription. Usage
  patterns that resemble API-style automation may be rate-limited or disallowed
  by Anthropic policy. Treat it as an interactive assistant, not a bulk API
  replacement.

## Failure messages

When a turn cannot run, Basecamp surfaces one of three friendly messages in
chat (from `_friendly_error` in `agent/claude_cli_client.py`):

- Binary missing: prompts you to install Claude Code.
- Not signed in: prompts you to run `claude login`.
- Usage limit reached: your Claude subscription quota is exhausted; try again
  later.
