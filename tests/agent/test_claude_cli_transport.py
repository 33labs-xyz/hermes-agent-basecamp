from pathlib import Path
from agent.transports.claude_cli import (
    ClaudeCliTransport,
    _active_turns,
    begin_turn,
    end_turn,
    run_claude_cli_turn,
)

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

    def test_end_turn_is_compare_and_delete(self):
        # Simulates: turn A registers, then (before A's delayed cleanup
        # runs) turn B registers under the same session_key. A's late
        # end_turn must not clobber B's still-active entry.
        turn_a = object()
        turn_b = object()
        key = "sess-race"

        begin_turn(key, turn_a)
        begin_turn(key, turn_b)
        end_turn(key, turn_a)
        assert _active_turns.get(key) is turn_b

        end_turn(key, turn_b)
        assert _active_turns.get(key) is None

    def test_build_kwargs_reads_only_hermes_session_id(self):
        transport = ClaudeCliTransport()
        messages = [{"role": "user", "content": "hi"}]

        # The old session_id key alone no longer drives session mapping.
        legacy_only = transport.build_kwargs(
            "claude-cli/sonnet", messages, session_id="legacy-should-be-ignored"
        )
        assert legacy_only["hermes_session_id"] is None

        canonical = transport.build_kwargs(
            "claude-cli/sonnet",
            messages,
            session_id="legacy-should-be-ignored",
            hermes_session_id="sess-canonical",
        )
        assert canonical["hermes_session_id"] == "sess-canonical"
