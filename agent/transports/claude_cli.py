"""Transport for the Claude Code CLI (subscription) provider.

All knowledge of the CLI's own headless protocol lives in
agent/claude_cli_client.py (Task 1). This module owns the mapping between
Hermes' OpenAI-format message history and that CLI, plus the bookkeeping
needed for multi-turn continuity:

- Hermes sends the full message history on every call. The CLI keeps its
  own history via --resume, so only the latest user message is forwarded;
  replaying the full history would duplicate turns the CLI already has.
- A module-level dict maps hermes_session_id -> cli_session_id so later
  turns in the same Hermes session resume the same underlying CLI
  conversation instead of starting fresh each time.
- A module-level active-turn registry lets an external caller (the
  interrupt handler) kill an in-flight CLI subprocess by hermes_session_id.

Stage 2 adds tool support: each turn gets an ephemeral MCP config (see
_prepare_mcp_bridge) that points the CLI at hermes_cli/mcp_bridge.py, a
stdio MCP server proxying hermes' own tools over localhost HTTP. The CLI
resolves any tool calls itself during the turn; Hermes never sees a
discrete tool-call round trip for this transport, so NormalizedResponse
.tool_calls is always None (tool activity surfaces only via the
on_tool_event callback, if one is supplied) and finish_reason is "stop"
on success or "error" on failure. When no MCP bridge can be wired up
(no hermes_session_id, or no dashboard web server running in this
process), a turn runs exactly like Stage 1: no tools, same as before.
"""
from __future__ import annotations

import json
import os
import secrets
import sys
import tempfile
import threading
import uuid
from typing import Any, Callable

from agent.claude_cli_client import ClaudeCliTurn, CliTurnResult, resolve_cli_path
from agent.transports.base import ProviderTransport
from agent.transports.types import NormalizedResponse, Usage
from hermes_cli.bridge_tokens import register_bridge_token, revoke_bridge_token

_MODEL_PREFIX = "claude-cli/"

_CLI_NOT_FOUND_MESSAGE = (
    "Claude Code CLI not found. Install it and run `claude login`, "
    "or set CLAUDE_CLI_PATH."
)

# Conservative, unverified substrings for detecting a --resume failure
# caused by the CLI having evicted/forgotten a session id. If the real
# CLI's wording does not match, the error surfaces as-is rather than being
# masked by a fallback retry (see run_claude_cli_turn).
_SESSION_EVICTED_MARKERS = (
    "no conversation found",
    "session not found",
    "unknown session",
    "could not find session",
    "no session found",
)

_TRUNCATION_NOTE = "Prior context may be truncated."

# hermes_session_id -> cli_session_id, so later turns in the same Hermes
# session pass --resume with the CLI's own session id instead of starting
# a brand new CLI conversation each turn.
_session_map: dict[str, str] = {}
_session_map_lock = threading.Lock()

# hermes_session_id -> in-flight ClaudeCliTurn, so an external caller can
# interrupt a running subprocess without holding a reference to it.
_active_turns: dict[str, ClaudeCliTurn] = {}
_active_turns_lock = threading.Lock()


def begin_turn(session_key: str, turn: ClaudeCliTurn) -> None:
    """Register a turn as in-flight for session_key.

    No-ops for a falsy session_key, mirroring the guard the session-
    continuity map uses on its own write-back (see run_claude_cli_turn).
    """
    if not session_key:
        return
    with _active_turns_lock:
        _active_turns[session_key] = turn


def end_turn(session_key: str, turn: ClaudeCliTurn | None = None) -> None:
    """Deregister the in-flight turn for session_key, if any.

    When turn is given, deregistration is compare-and-delete: the entry
    is only removed if it still holds this exact turn object. This
    guards against a late cleanup from an interrupted turn A clobbering
    a newer turn B that was registered under the same session_key while
    A was still unwinding. When turn is omitted, deregisters
    unconditionally.
    """
    if not session_key:
        return
    with _active_turns_lock:
        if turn is None:
            _active_turns.pop(session_key, None)
            return
        if _active_turns.get(session_key) is turn:
            del _active_turns[session_key]


def interrupt_turn(session_key: str) -> bool:
    """Kill the in-flight turn for session_key, if one is registered.

    Returns True if a turn was found and killed, False if none was active.
    """
    with _active_turns_lock:
        turn = _active_turns.get(session_key)
    if turn is None:
        return False
    turn.kill()
    return True


def _strip_model_prefix(model: str) -> str:
    if model.startswith(_MODEL_PREFIX):
        return model[len(_MODEL_PREFIX):]
    return model


def _message_text(content: Any) -> str:
    """Best-effort plain-text extraction from a message's content field.

    OpenAI-format content is usually a plain string, but may be a list of
    content blocks (multi-modal messages). Only text blocks are kept; the
    CLI has no image input in Stage 1.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            block["text"]
            for block in content
            if isinstance(block, dict) and isinstance(block.get("text"), str)
        ]
        return "\n".join(parts)
    return str(content)


def _first_system_prompt(messages: list[dict[str, Any]]) -> str | None:
    for message in messages:
        if isinstance(message, dict) and message.get("role") == "system":
            return _message_text(message.get("content"))
    return None


def _last_user_text(messages: list[dict[str, Any]]) -> str:
    for message in reversed(messages):
        if isinstance(message, dict) and message.get("role") == "user":
            return _message_text(message.get("content"))
    return ""


def _looks_like_evicted_session(error: str | None) -> bool:
    if not error:
        return False
    lowered = error.lower()
    return any(marker in lowered for marker in _SESSION_EVICTED_MARKERS)


def _usage_from_cli(raw: dict[str, Any] | None) -> Usage | None:
    if not raw:
        return None
    input_tokens = raw.get("input_tokens", 0) or 0
    output_tokens = raw.get("output_tokens", 0) or 0
    return Usage(
        prompt_tokens=input_tokens,
        completion_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
    )


class ClaudeCliTransport(ProviderTransport):
    """ProviderTransport for the Claude Code CLI subscription provider."""

    @property
    def api_mode(self) -> str:
        return "claude_cli"

    def convert_messages(
        self, messages: list[dict[str, Any]], **kwargs
    ) -> tuple[str | None, str]:
        """Extract (system_prompt, prompt) from an OpenAI-format history.

        Only the first system message and the latest user message matter;
        the CLI keeps the rest of the conversation via --resume.
        """
        return _first_system_prompt(messages), _last_user_text(messages)

    def convert_tools(self, tools: list[dict[str, Any]] | None) -> None:
        """Tools are ignored in Stage 1; the CLI runs with no tools."""
        return None

    def build_kwargs(
        self,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        **params,
    ) -> dict[str, Any]:
        """Build the api_kwargs dict run_claude_cli_turn() consumes.

        hermes_session_id is the single canonical key for the Hermes
        session identifier; it is the key run_claude_cli_turn() reads to
        key CLI session continuity and the interrupt registry. Callers
        must pass it by that name.
        """
        return {
            "model": model,
            "messages": messages,
            "hermes_session_id": params.get("hermes_session_id"),
        }

    def normalize_response(
        self, response: CliTurnResult, **kwargs
    ) -> NormalizedResponse:
        """Map a completed CliTurnResult to a NormalizedResponse.

        There is no provider SDK object in this transport; the CLI
        subprocess's parsed result IS the response being normalized.
        """
        if response.error:
            return NormalizedResponse(
                content=response.error,
                tool_calls=None,
                finish_reason="error",
            )
        return NormalizedResponse(
            content=response.text,
            tool_calls=None,
            finish_reason="stop",
            usage=_usage_from_cli(response.usage),
        )

    def validate_response(self, response: Any) -> bool:
        return isinstance(response, CliTurnResult)


def _execute_turn(
    *,
    prompt: str,
    model: str,
    system_prompt: str | None,
    session_id: str,
    resume: bool,
    session_key: str,
    mcp_config_path: str | None,
    on_delta: Callable[[str], None] | None,
    on_tool_event: Callable[[dict], None] | None,
) -> CliTurnResult:
    """Run one ClaudeCliTurn, tracked in the active-turn registry."""
    turn = ClaudeCliTurn(
        prompt=prompt,
        model=model,
        system_prompt=system_prompt,
        session_id=session_id,
        resume=resume,
        mcp_config_path=mcp_config_path,
        on_delta=on_delta,
        on_tool_event=on_tool_event,
    )
    begin_turn(session_key, turn)
    try:
        return turn.run()
    finally:
        end_turn(session_key, turn)


def _resolve_gateway_base_url() -> str | None:
    """HTTP base URL of the hermes dashboard's own web server, if this
    process is hosting one.

    The MCP bridge subprocess (hermes_cli/mcp_bridge.py) needs a URL to
    call back into /api/internal/tool-call and /api/internal/tool-schemas.
    hermes_cli/web_server.py already tracks its own live bind address on
    app.state.bound_host / app.state.bound_port (set in start_server(),
    with bound_port read back from the live uvicorn socket so an
    ephemeral port resolves correctly). Two existing helpers there already
    build a URL from that same pair for a spawned child process to dial
    back in: _build_gateway_ws_url() / _build_sidecar_url() (IPv6-literal
    bracket wrapping) and _maybe_open_browser() (0.0.0.0 / :: -> 127.0.0.1,
    since a wildcard bind address is not itself dialable). The MCP bridge
    subprocess is a dialer like both of those, so this combines both: the
    wildcard-bind normalization, then bracket-wrap whatever host remains
    if it is still IPv6-literal (covers a real "::1" bind, which the
    wildcard check does not touch).

    Imported lazily so a claude_cli turn that never touches the dashboard
    (a bare terminal session with no web server running) never pays for
    importing hermes_cli.web_server's full FastAPI/uvicorn import graph -
    the same reasoning hermes_cli/bridge_tokens.py documents for staying
    out of web_server.py. Returns None (never raises) when no web server
    is running in this process, or it has not finished binding yet; the
    caller treats that as "no MCP bridge for this turn", not an error - a
    bare CLI session with no dashboard is an ordinary, expected state.
    """
    try:
        from hermes_cli.web_server import app
    except Exception:
        return None
    host = getattr(app.state, "bound_host", None)
    port = getattr(app.state, "bound_port", None)
    if not host or not port:
        return None
    display_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    if ":" in display_host and not display_host.startswith("["):
        display_host = f"[{display_host}]"
    return f"http://{display_host}:{port}"


def _write_mcp_config(hermes_session_id: str, token: str, base_url: str) -> str:
    """Write the ephemeral per-turn MCP config the CLI reads via
    --mcp-config, pointing it at hermes' own stdio bridge (mcp_bridge.py)
    so the CLI sees only Basecamp's tools - build_command() already adds
    --strict-mcp-config --tools "" whenever a config path is passed, which
    is what keeps the CLI's own built-in file/bash tools out of the mix.

    Returns the temp file's path. Created with delete=False because the
    CLI subprocess reads it from disk well after this function returns;
    the caller (run_claude_cli_turn) deletes it once the turn ends.
    """
    config = {
        "mcpServers": {
            "basecamp": {
                "command": sys.executable,
                "args": [
                    "-m", "hermes_cli.mcp_bridge",
                    "--gateway-url", base_url,
                    "--session-id", hermes_session_id,
                    "--bridge-token", token,
                ],
            }
        }
    }
    handle = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    try:
        json.dump(config, handle)
        handle.close()
    except BaseException:
        # A write failure (disk full / quota mid-dump) must not orphan the
        # file: the caller only ever learns this path via the return value,
        # so an exception here would leave it on disk with no one holding a
        # reference to delete it. Unlink it, then re-raise so the caller can
        # revoke the token it already registered.
        try:
            handle.close()
        except OSError:
            pass
        try:
            os.remove(handle.name)
        except OSError:
            pass
        raise
    return handle.name


def _prepare_mcp_bridge(session_key: str) -> str | None:
    """Mint and register a per-turn bridge token, then write the MCP
    config that points the CLI at it.

    Returns the config path, or None when there is no session_key to key
    the token under, or no reachable gateway base URL (see
    _resolve_gateway_base_url) - the turn then runs exactly like Stage 1,
    with no tools, instead of failing. The token itself is never returned;
    nothing outside this module needs the raw value, only the config file
    that already embeds it and the session_key used to revoke it later.
    """
    if not session_key:
        return None
    base_url = _resolve_gateway_base_url()
    if not base_url:
        return None
    token = secrets.token_urlsafe(32)
    register_bridge_token(session_key, token)
    try:
        return _write_mcp_config(session_key, token, base_url)
    except OSError:
        revoke_bridge_token(session_key)
        return None


def _cleanup_mcp_bridge(session_key: str, mcp_config_path: str | None) -> None:
    """Revoke the bridge token and delete the ephemeral config file.

    Called once from run_claude_cli_turn's finally block regardless of
    whether the turn(s) inside it succeeded. mcp_config_path is None
    exactly when _prepare_mcp_bridge never registered a token, so gating
    on it here skips a pointless revoke call for a token that was never
    minted.
    """
    if not mcp_config_path:
        return
    revoke_bridge_token(session_key)
    try:
        os.remove(mcp_config_path)
    except OSError:
        pass


def run_claude_cli_turn(
    api_kwargs: dict[str, Any],
    on_delta: Callable[[str], None] | None = None,
    on_tool_event: Callable[[dict], None] | None = None,
    enable_tools: bool = True,
) -> NormalizedResponse:
    """Run a single Hermes turn against the Claude Code CLI.

    Reads api_kwargs["model"], api_kwargs["messages"], and
    api_kwargs["hermes_session_id"]. Does not mutate api_kwargs or any of
    its contents.

    Resolves CLI session continuity from the module-level session map:
    the first turn for a hermes_session_id creates a fresh CLI session,
    later turns resume it. If a resume attempt fails because the CLI
    session was evicted, falls back once to a fresh session with a
    truncation note prepended to the system prompt.

    enable_tools=False skips the MCP bridge entirely for this turn (the
    CLI still runs with --tools "", so zero built-in tools either) while
    leaving hermes_session_id / --resume continuity untouched. This is
    for callers like handle_max_iterations() that need a text-only reply
    grounded in the CLI's full --resume history, not a from-scratch
    session: the model must not call another tool once the iteration
    limit is already hit, but it still needs the conversation so far to
    have anything to summarize.
    """
    if resolve_cli_path() is None:
        return NormalizedResponse(
            content=_CLI_NOT_FOUND_MESSAGE,
            tool_calls=None,
            finish_reason="error",
        )

    transport = ClaudeCliTransport()
    model = _strip_model_prefix(str(api_kwargs.get("model") or ""))
    messages = api_kwargs.get("messages") or []
    session_key = str(api_kwargs.get("hermes_session_id") or "")

    system_prompt, prompt = transport.convert_messages(messages)

    with _session_map_lock:
        cli_session_id = _session_map.get(session_key)

    resume = cli_session_id is not None
    session_id = cli_session_id if resume else str(uuid.uuid4())

    # One bridge token/config covers both the primary attempt and the
    # eviction-fallback retry below: they are the same logical turn, and
    # minting a second token for the retry would just be a second thing
    # to clean up for no benefit. Prepared inside the try so that even if
    # _prepare_mcp_bridge raises after registering the token, the finally
    # still revokes it: the guarantee is "cleaned up exactly once on every
    # exit path".
    mcp_config_path: str | None = None
    try:
        if enable_tools:
            mcp_config_path = _prepare_mcp_bridge(session_key)
        result = _execute_turn(
            prompt=prompt,
            model=model,
            system_prompt=system_prompt,
            session_id=session_id,
            resume=resume,
            session_key=session_key,
            mcp_config_path=mcp_config_path,
            on_delta=on_delta,
            on_tool_event=on_tool_event,
        )

        if resume and result.error and _looks_like_evicted_session(result.error):
            fallback_system_prompt = (
                _TRUNCATION_NOTE
                if not system_prompt
                else f"{_TRUNCATION_NOTE}\n{system_prompt}"
            )
            session_id = str(uuid.uuid4())
            result = _execute_turn(
                prompt=prompt,
                model=model,
                system_prompt=fallback_system_prompt,
                session_id=session_id,
                resume=False,
                session_key=session_key,
                mcp_config_path=mcp_config_path,
                on_delta=on_delta,
                on_tool_event=on_tool_event,
            )
    finally:
        _cleanup_mcp_bridge(session_key, mcp_config_path)

    if session_key:
        with _session_map_lock:
            _session_map[session_key] = result.session_id or session_id

    return transport.normalize_response(result)


from agent.transports import register_transport  # noqa: E402

register_transport("claude_cli", ClaudeCliTransport)
