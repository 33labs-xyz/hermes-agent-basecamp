from pathlib import Path

from providers import get_provider_profile

FAKE = str(Path(__file__).parent.parent / "agent" / "fixtures" / "fake_claude.sh")


class TestClaudeCliProfile:
    def test_registered(self):
        p = get_provider_profile("claude-cli")
        assert p is not None
        assert p.api_mode == "claude_cli"

    def test_display_name(self):
        p = get_provider_profile("claude-cli")
        assert p.display_name == "Claude (subscription)"

    def test_no_env_keys_required(self):
        p = get_provider_profile("claude-cli")
        assert p.env_vars == ()

    def test_fallback_models(self):
        p = get_provider_profile("claude-cli")
        assert p.fallback_models == (
            "claude-cli/opus",
            "claude-cli/sonnet",
            "claude-cli/haiku",
        )

    def test_fetch_models_returns_fallback_no_network(self):
        p = get_provider_profile("claude-cli")
        assert p.fetch_models() == [
            "claude-cli/opus",
            "claude-cli/sonnet",
            "claude-cli/haiku",
        ]

    def test_authenticated_tracks_binary_presence(self, monkeypatch):
        from agent.claude_cli_client import resolve_cli_path

        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE)
        assert resolve_cli_path() is not None
        monkeypatch.setenv("CLAUDE_CLI_PATH", "/nonexistent")
        monkeypatch.setenv("PATH", "/nonexistent")
        assert resolve_cli_path() is None
