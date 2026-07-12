from pathlib import Path
from agent.transports.claude_cli import ClaudeCliTransport, run_claude_cli_turn

FAKE = str(Path(__file__).parent / "fixtures" / "fake_claude.sh")

def _kwargs(model="claude-cli/sonnet"):
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "hi"},
        ],
        "hermes_session_id": "sess-1",
    }

class TestTransport:
    def test_api_mode(self):
        assert ClaudeCliTransport().api_mode == "claude_cli"

    def test_turn_returns_normalized_response(self, monkeypatch):
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE)
        resp = run_claude_cli_turn(_kwargs())
        assert resp.content == "Hello world"
        assert resp.tool_calls is None
        assert resp.finish_reason == "stop"

    def test_model_prefix_stripped(self, monkeypatch):
        # claude-cli/sonnet -> CLI receives bare "sonnet"
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE)
        resp = run_claude_cli_turn(_kwargs("claude-cli/opus"))
        assert resp.finish_reason == "stop"

    def test_missing_cli_yields_error_response(self, monkeypatch):
        monkeypatch.setenv("CLAUDE_CLI_PATH", "/nonexistent/claude")
        monkeypatch.setenv("PATH", "/nonexistent")
        resp = run_claude_cli_turn(_kwargs())
        assert resp.finish_reason == "error"
        assert "claude login" in (resp.content or "").lower() or "not found" in (resp.content or "").lower()
