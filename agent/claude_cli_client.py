"""All knowledge of the Claude Code CLI headless protocol lives here.

Protocol (verified against CLI 2.1.202): one JSON object per stdout line.
  {"type":"system","subtype":"init","session_id":...}
  {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":...}}}
  {"type":"result","subtype":"success","result":<full text>,"session_id":...,"usage":{...}}
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
    cmd.append(prompt)
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
            stderr_tail = (self._proc.stderr.read() or "")[-2000:] if self._proc.stderr else ""
            if self._proc.returncode != 0 and not result.text:
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
            result.text = event.get("result") or result.text
            result.session_id = event.get("session_id") or result.session_id
            result.usage = event.get("usage")
            if event.get("subtype") not in (None, "success"):
                result.error = event.get("result") or f"CLI turn failed: {event.get('subtype')}"

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
