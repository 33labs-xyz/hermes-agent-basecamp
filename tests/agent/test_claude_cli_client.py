import os
from pathlib import Path
import pytest
from agent.claude_cli_client import build_command, resolve_cli_path, ClaudeCliTurn

FAKE = str(Path(__file__).parent / "fixtures" / "fake_claude.sh")

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

class TestResolveCliPath:
    def test_env_override_wins(self, monkeypatch):
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE)
        assert resolve_cli_path() == FAKE

    def test_missing_binary_returns_none(self, monkeypatch):
        monkeypatch.setenv("CLAUDE_CLI_PATH", "/nonexistent/claude")
        monkeypatch.setenv("PATH", "/nonexistent")
        assert resolve_cli_path() is None

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
