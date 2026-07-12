from hermes_cli.providers import (
    TRANSPORT_TO_API_MODE,
    determine_api_mode,
    get_provider,
)


def test_transport_map_has_claude_cli():
    assert TRANSPORT_TO_API_MODE["claude_cli"] == "claude_cli"


def test_overlay_registered_with_claude_cli_transport():
    pdef = get_provider("claude-cli")
    assert pdef is not None
    assert pdef.transport == "claude_cli"


def test_api_mode_resolves_to_claude_cli():
    assert determine_api_mode("claude-cli") == "claude_cli"
