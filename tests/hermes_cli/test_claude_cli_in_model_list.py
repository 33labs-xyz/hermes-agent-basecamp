"""The local `claude` CLI binary surfaces claude-cli in the /model picker.

Task 4 wires list_authenticated_providers() so the Claude (subscription)
provider (slug claude-cli, auth_type external_process, no API key / no
HTTP endpoint) is treated as authenticated iff the `claude` CLI binary is
resolvable (CLAUDE_CLI_PATH env override or `claude` on PATH) - see
hermes_cli/model_switch.py's has_creds ladder, scoped strictly to
hermes_slug == "claude-cli" so copilot-acp (also external_process) is
never falsely marked authenticated by the presence of a `claude` binary.

NOTE on template substitution: Task 4's brief pointed at
tests/hermes_cli/test_api_key_providers.py as the reference for how
list_authenticated_providers is exercised, but that file contains zero
calls to list_authenticated_providers (it tests PROVIDER_REGISTRY /
resolve_provider / get_api_key_provider_status instead). This test
mirrors tests/hermes_cli/test_anthropic_subscription_in_model_list.py
instead, which exercises the exact same has_creds-ladder/HERMES_OVERLAYS
loop this task modifies, substituting a resolve_cli_path mock for the
anthropic on-disk-creds mocks.
"""

import os
from contextlib import ExitStack
from unittest.mock import patch

from hermes_cli.model_switch import list_authenticated_providers


class _FakePool:
    """Credential pool that reports nothing, so claude-cli can only be
    surfaced by the resolve_cli_path fallback path under test."""

    def has_credentials(self):
        return False


def _offline_catalog(slug):
    # Deterministic offline model list so the test never touches the gateway.
    if slug == "claude-cli":
        return ["claude-cli/opus", "claude-cli/sonnet", "claude-cli/haiku"]
    return []


def _list_with_cli_path(cli_path):
    """Run the picker with every other credential source empty, so the ONLY
    thing that can surface claude-cli is resolve_cli_path()."""
    with ExitStack() as stack:
        stack.enter_context(patch.dict(os.environ, {}, clear=False))
        stack.enter_context(patch("agent.models_dev.fetch_models_dev", return_value={}))
        stack.enter_context(
            patch("hermes_cli.models.cached_provider_model_ids", side_effect=_offline_catalog)
        )
        stack.enter_context(patch("hermes_cli.auth._load_auth_store", return_value={}))
        stack.enter_context(patch("agent.credential_pool.load_pool", return_value=_FakePool()))
        stack.enter_context(
            patch("agent.claude_cli_client.resolve_cli_path", return_value=cli_path)
        )
        return list_authenticated_providers(current_provider="openrouter", max_models=50)


def _find_claude_cli(providers):
    return next((p for p in providers if p["slug"] == "claude-cli"), None)


def test_binary_present_surfaces_claude_cli_with_models_and_label():
    providers = _list_with_cli_path("/usr/local/bin/claude")

    row = _find_claude_cli(providers)
    assert row is not None
    assert row["name"] == "Claude (subscription)"
    assert "claude-cli/opus" in row["models"]


def test_binary_absent_hides_claude_cli():
    providers = _list_with_cli_path(None)

    assert _find_claude_cli(providers) is None
