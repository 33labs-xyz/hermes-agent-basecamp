"""Claude (subscription) provider profile - local `claude` CLI subprocess.

No HTTP endpoint and no API key: inference runs by spawning the user's local
Claude Code CLI (Task 1/2 transport). The picker/label wiring lives in
hermes_cli/providers.py + model_switch.py; this profile satisfies the
providers/ plugin registry (get_provider_profile consumers).
"""

from providers import register_provider
from providers.base import ProviderProfile


class ClaudeCliProfile(ProviderProfile):
    """Claude Code subscription via the local `claude` CLI (no HTTP, no API key)."""

    def fetch_models(
        self, *, api_key=None, base_url=None, timeout: float = 8.0
    ) -> list[str] | None:
        return list(self.fallback_models)


claude_cli = ClaudeCliProfile(
    name="claude-cli",
    api_mode="claude_cli",
    aliases=("claude-sub", "claude-subscription"),
    display_name="Claude (subscription)",
    description="Claude Code subscription via the local claude CLI",
    env_vars=(),
    base_url="",
    auth_type="external_process",
    fallback_models=(
        "claude-cli/opus",
        "claude-cli/sonnet",
        "claude-cli/haiku",
    ),
    supports_vision=False,
)

register_provider(claude_cli)
