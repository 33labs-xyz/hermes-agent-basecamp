import os
from pathlib import Path
import pytest
from agent.claude_cli_client import (
    build_command, resolve_cli_path, ClaudeCliTurn, CliTurnResult,
)

FAKE = str(Path(__file__).parent / "fixtures" / "fake_claude.sh")
FAKE_AUTH_ERROR = str(Path(__file__).parent / "fixtures" / "fake_claude_auth_error.sh")
FAKE_NOISY_STDERR = str(Path(__file__).parent / "fixtures" / "fake_claude_noisy_stderr.sh")

class TestBuildCommand:
    def test_includes_isolation_flags(self):
        cmd = build_command("hi", model="sonnet")
        for flag in ("--setting-sources", "--strict-mcp-config", "-p",
                     "--output-format", "--verbose", "--include-partial-messages"):
            assert flag in cmd
        assert cmd[cmd.index("--setting-sources") + 1] == ""

    def test_no_mcp_config_means_no_tools(self):
        cmd = build_command("hi", model="sonnet")
        assert "--tools" in cmd
        assert cmd[cmd.index("--tools") + 1] == ""
        assert "--mcp-config" not in cmd

    def test_resume_uses_resume_flag(self):
        cmd = build_command("hi", model="opus", session_id="abc", resume=True)
        assert "--resume" in cmd and "abc" in cmd

    def test_first_turn_pins_session_id(self):
        cmd = build_command("hi", model="opus", session_id="abc", resume=False)
        assert "--session-id" in cmd and "--resume" not in cmd

    def test_prompt_is_last_and_sentinel_terminated(self):
        # Regression test: --tools <tools...> is variadic (Commander.js) and
        # greedily swallows a trailing bare prompt with no flag in between.
        # This is exactly the no-system-prompt, no-session-id shape that
        # broke against the real CLI, so "--" must always precede the prompt.
        cmd = build_command("hi", model="sonnet")
        assert cmd[-1] == "hi"
        assert cmd[-2] == "--"

    def test_sentinel_precedes_prompt_regardless_of_optional_flags(self):
        cmd = build_command(
            "hi", model="opus", system_prompt="be nice",
            session_id="abc", resume=True, mcp_config_path="/tmp/mcp.json",
        )
        assert cmd[-1] == "hi"
        assert cmd[-2] == "--"

class TestResolveCliPath:
    def test_env_override_wins(self, monkeypatch):
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE)
        assert resolve_cli_path() == FAKE

    def test_missing_binary_returns_none(self, monkeypatch):
        monkeypatch.setenv("CLAUDE_CLI_PATH", "/nonexistent/claude")
        monkeypatch.setenv("PATH", "/nonexistent")
        assert resolve_cli_path() is None

    def test_falls_back_to_path_lookup(self, monkeypatch):
        # No CLAUDE_CLI_PATH override: resolve_cli_path() must fall through
        # to shutil.which("claude") on PATH.
        monkeypatch.delenv("CLAUDE_CLI_PATH", raising=False)
        monkeypatch.setattr(
            "agent.claude_cli_client.shutil.which",
            lambda name: "/sentinel/path/claude",
        )
        assert resolve_cli_path() == "/sentinel/path/claude"

class TestClaudeCliTurn:
    def test_parses_stream(self, monkeypatch):
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE)
        turn = ClaudeCliTurn(prompt="hi", model="sonnet")
        result = turn.run(timeout=10.0)
        assert result.error is None
        assert result.text == "Hello world"
        assert result.session_id == "11111111-1111-1111-1111-111111111111"
        assert result.usage == {"input_tokens": 10, "output_tokens": 2}

    def test_delta_callback_fires(self, monkeypatch):
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE)
        seen = []
        turn = ClaudeCliTurn(prompt="hi", model="sonnet", on_delta=seen.append)
        turn.run(timeout=10.0)
        assert seen == ["Hello ", "world"]

    def test_is_error_result_populates_error_not_text(self, monkeypatch):
        # Regression test: the real CLI signals an auth/exec failure with a
        # terminal result event where "subtype" is still "success" but
        # "is_error" is true, and exits 1 with nothing on stderr. That must
        # surface as CliTurnResult.error carrying the CLI's own failure text,
        # not be silently returned as a normal assistant-text reply, and not
        # be clobbered by the generic stderr-based fallback in run().
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE_AUTH_ERROR)
        turn = ClaudeCliTurn(prompt="hi", model="sonnet")
        result = turn.run(timeout=10.0)
        assert result.error is not None
        assert "Not logged in" in result.error
        assert result.text == ""

    def test_large_stderr_does_not_deadlock(self, monkeypatch):
        # Regression test: --verbose is mandated on every spawn, so
        # non-trivial stderr volume is realistic. If stdout and stderr are
        # not drained concurrently, a child that writes a large chunk to
        # stderr before finishing stdout fills the OS pipe buffer and
        # deadlocks both sides until the timer's kill() fires. 30s is
        # generous but finite: with a working concurrent drain this finishes
        # almost immediately; without one, this test would only "pass" by
        # being killed (empty text, error set) after the full 30s.
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE_NOISY_STDERR)
        turn = ClaudeCliTurn(prompt="hi", model="sonnet")
        result = turn.run(timeout=30.0)
        assert result.text == "Hello world"
        assert result.error is None

    def test_is_error_with_no_detail_yields_clear_message(self):
        # Regression test: the real CLI leaves "subtype":"success" even on
        # is_error:true, so an is_error result with no "result" text must
        # not produce the confusing "CLI turn failed: success" message.
        turn = ClaudeCliTurn(prompt="hi", model="sonnet")
        result = CliTurnResult()
        event = {
            "type": "result",
            "subtype": "success",
            "is_error": True,
            "session_id": "44444444-4444-4444-4444-444444444444",
        }
        turn._handle_event(event, result)
        assert result.error == "CLI turn failed (is_error, no detail from CLI)"
        assert result.text == ""
