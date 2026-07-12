"""All knowledge of the Claude Code CLI headless protocol lives here.

Protocol (verified against CLI 2.1.202): one JSON object per stdout line.
  {"type":"system","subtype":"init","session_id":...}
  {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":...}}}
  {"type":"result","subtype":"success","result":<full text>,"session_id":...,"usage":{...}}

Gotcha (verified live against CLI 2.1.202): an auth/exec failure still reports
"subtype":"success" but sets "is_error":true, with the failure text in "result".
  {"type":"result","subtype":"success","is_error":true,"result":<failure text>,...}
Also, "--tools <tools...>" is a variadic option and greedily swallows any bare
token after it, including a trailing positional prompt with no flag in between.
A literal "--" sentinel is inserted before the prompt in build_command() so the
prompt always parses as a positional operand.
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import threading
from dataclasses import dataclass, field
from typing import Callable

DEFAULT_TIMEOUT_SECONDS = 300.0
_KILL_GRACE_SECONDS = 5.0
_STDERR_JOIN_GRACE_SECONDS = 5.0


def resolve_cli_path() -> str | None:
    override = os.environ.get("CLAUDE_CLI_PATH")
    if override:
        return override if os.path.isfile(override) and os.access(override, os.X_OK) else None
    return shutil.which("claude")


def build_command(
    prompt: str,
    model: str,
    system_prompt: str | None = None,
    session_id: str | None = None,
    resume: bool = False,
    mcp_config_path: str | None = None,
    cli_path: str | None = None,
) -> list[str]:
    cmd = [
        cli_path or "claude",
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--setting-sources", "",
        "--strict-mcp-config",
        "--model", model,
    ]
    if mcp_config_path:
        cmd += ["--mcp-config", mcp_config_path, "--tools", ""]
    else:
        cmd += ["--tools", ""]
    if system_prompt:
        cmd += ["--append-system-prompt", system_prompt]
    if session_id:
        cmd += (["--resume", session_id] if resume else ["--session-id", session_id])
    # "--" ends flag parsing so the prompt is always a positional operand, never
    # absorbed by a preceding variadic option such as --tools <tools...>.
    cmd += ["--", prompt]
    return cmd


@dataclass
class CliTurnResult:
    text: str = ""
    session_id: str | None = None
    usage: dict | None = None
    deltas_seen: int = 0
    error: str | None = None


@dataclass
class ClaudeCliTurn:
    prompt: str
    model: str
    system_prompt: str | None = None
    session_id: str | None = None
    resume: bool = False
    mcp_config_path: str | None = None
    on_delta: Callable[[str], None] | None = None
    on_tool_event: Callable[[dict], None] | None = None
    _proc: subprocess.Popen | None = field(default=None, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def run(self, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> CliTurnResult:
        cli_path = resolve_cli_path()
        if cli_path is None:
            return CliTurnResult(error=(
                "Claude Code CLI not found. Install it and run `claude login`, "
                "or set CLAUDE_CLI_PATH."
            ))
        cmd = build_command(
            self.prompt, self.model, self.system_prompt,
            self.session_id, self.resume, self.mcp_config_path, cli_path,
        )
        env = {k: v for k, v in os.environ.items()}
        with self._lock:
            self._proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
                start_new_session=True,
            )
        result = CliTurnResult()
        stderr_chunks: list[str] = []

        def _drain_stderr() -> None:
            # Runs on its own thread, started before the stdout loop below.
            # --verbose is mandated on every spawn, so the child can produce
            # enough stderr volume to fill the OS pipe buffer (~64KB). If
            # stderr were only read after stdout reaches EOF, a child that
            # blocks writing a full stderr buffer while it still has stdout
            # left to produce would deadlock against this same read loop:
            # neither side can proceed until the timer's kill() intervenes.
            stream = self._proc.stderr
            if stream is None:
                return
            try:
                for chunk in stream:
                    stderr_chunks.append(chunk)
            except (ValueError, OSError):
                pass  # stream closed by kill(); nothing more to read

        stderr_thread = threading.Thread(target=_drain_stderr, daemon=True)
        stderr_thread.start()
        timer = threading.Timer(timeout, self.kill)
        timer.start()
        try:
            assert self._proc.stdout is not None
            for line in self._proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                self._handle_event(event, result)
            self._proc.wait()
            stderr_thread.join(timeout=_STDERR_JOIN_GRACE_SECONDS)
            stderr_tail = ("".join(stderr_chunks))[-2000:]
            # Only fall back to a generic stderr-based message when the result
            # event itself did not already report a specific failure (e.g. the
            # CLI's own "Not logged in" text from an is_error result).
            if self._proc.returncode != 0 and not result.text and result.error is None:
                result.error = _friendly_error(self._proc.returncode, stderr_tail)
        finally:
            timer.cancel()
            self.kill()
        return result

    def _handle_event(self, event: dict, result: CliTurnResult) -> None:
        etype = event.get("type")
        if etype == "system" and event.get("subtype") == "init":
            result.session_id = event.get("session_id") or result.session_id
        elif etype == "stream_event":
            delta = (event.get("event") or {}).get("delta") or {}
            if delta.get("type") == "text_delta":
                text = delta.get("text", "")
                result.deltas_seen += 1
                if self.on_delta:
                    self.on_delta(text)
        elif etype in ("assistant", "user") and self.on_tool_event:
            self.on_tool_event(event)
        elif etype == "result":
            result.session_id = event.get("session_id") or result.session_id
            result.usage = event.get("usage")
            if event.get("is_error") or event.get("subtype") not in (None, "success"):
                # The real CLI leaves "subtype":"success" even on is_error,
                # so an is_error result with no detail must not read as the
                # confusing "CLI turn failed: success".
                detail = event.get("result")
                if detail:
                    result.error = detail
                elif event.get("is_error"):
                    result.error = "CLI turn failed (is_error, no detail from CLI)"
                else:
                    result.error = f"CLI turn failed: {event.get('subtype')}"
            else:
                result.text = event.get("result") or result.text

    def kill(self) -> None:
        with self._lock:
            proc = self._proc
        if proc is None or proc.poll() is not None:
            return
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGINT)
            proc.wait(timeout=_KILL_GRACE_SECONDS)
        except (subprocess.TimeoutExpired, ProcessLookupError, PermissionError):
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass


def _friendly_error(returncode: int, stderr_tail: str) -> str:
    lowered = stderr_tail.lower()
    if "log in" in lowered or "authentication" in lowered or "oauth" in lowered:
        return "Claude Code CLI is not signed in. Run `claude login` in a terminal, then retry."
    if "rate limit" in lowered or "usage limit" in lowered:
        return "Claude subscription usage limit reached. It resets on a rolling window; switch model to continue now."
    return f"Claude CLI exited with code {returncode}: {stderr_tail or 'no stderr output'}"
