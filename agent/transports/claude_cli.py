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

Stage 1 scope: tools are not forwarded to the CLI, so NormalizedResponse
.tool_calls is always None and finish_reason is "stop" on success or
"error" on failure.
"""
from __future__ import annotations

import threading
import uuid
from typing import Any, Callable

from agent.claude_cli_client import ClaudeCliTurn, CliTurnResult, resolve_cli_path
from agent.transports.base import ProviderTransport
from agent.transports.types import NormalizedResponse, Usage

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
    """Register a turn as in-flight for session_key."""
    with _active_turns_lock:
        _active_turns[session_key] = turn


def end_turn(session_key: str) -> None:
    """Deregister the in-flight turn for session_key, if any."""
    with _active_turns_lock:
        _active_turns.pop(session_key, None)


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

        Every other transport's build_kwargs call site passes the Hermes
        session identifier as session_id (agent.session_id); it is carried
        through here as hermes_session_id, the key run_claude_cli_turn()
        reads to key CLI session continuity and the interrupt registry.
        hermes_session_id is also accepted directly for callers that
        already use that name.
        """
        session_id = params.get("hermes_session_id") or params.get("session_id")
        return {
            "model": model,
            "messages": messages,
            "hermes_session_id": session_id,
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
        on_delta=on_delta,
        on_tool_event=on_tool_event,
    )
    begin_turn(session_key, turn)
    try:
        return turn.run()
    finally:
        end_turn(session_key)


def run_claude_cli_turn(
    api_kwargs: dict[str, Any],
    on_delta: Callable[[str], None] | None = None,
    on_tool_event: Callable[[dict], None] | None = None,
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

    result = _execute_turn(
        prompt=prompt,
        model=model,
        system_prompt=system_prompt,
        session_id=session_id,
        resume=resume,
        session_key=session_key,
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
            on_delta=on_delta,
            on_tool_event=on_tool_event,
        )

    if session_key:
        with _session_map_lock:
            _session_map[session_key] = result.session_id or session_id

    return transport.normalize_response(result)


from agent.transports import register_transport  # noqa: E402

register_transport("claude_cli", ClaudeCliTransport)
