"""On-disk Claude Code (~/.claude) subscription creds surface anthropic in the
/model picker.

Root cause verified 2026-07-04: the app's anthropic OAuth transport DOES accept
the on-disk subscription token — a live 1-token call through this app's client
(Bearer + oauth-2025-04-20 beta + Claude Code user-agent + system prefix)
returned HTTP 200. The GUI inventory (list_authenticated_providers) was hiding
anthropic even when usable subscription creds exist on disk. These tests lock
the corrected behavior:

  - valid on-disk creds       -> anthropic present, with claude models
  - expired but refreshable   -> present (matches resolve_anthropic_token's
                                 auto-refresh path)
  - expired, no refresh token -> hidden (dead token; preserve the legit hide)
  - no creds anywhere         -> hidden (preserve the base hide)

The two negative cases already pass pre-fix (guard against regression); the two
positive cases are the RED that the fix turns GREEN.
"""

import os
from contextlib import ExitStack
from unittest.mock import patch

from hermes_cli.model_switch import list_authenticated_providers


class _FakePool:
    """Credential pool that reports nothing, so anthropic can only be surfaced
    by the on-disk Claude Code path under test."""

    def has_credentials(self):
        return False


def _offline_catalog(slug):
    # Deterministic offline model list so the test never touches the gateway.
    if slug == "anthropic":
        return ["claude-sonnet-4-5", "claude-opus-4-1"]
    return []


def _list_with_cc_creds(cc_creds, token_valid):
    """Run the picker with every OTHER anthropic credential source absent (no
    env tokens, empty auth store, empty credential pool, no hermes-managed OAuth
    login), so the ONLY thing that can surface anthropic is the user's on-disk
    Claude Code subscription login."""
    with ExitStack() as stack:
        stack.enter_context(patch.dict(os.environ, {}, clear=False))
        for var in ("ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"):
            os.environ.pop(var, None)
        stack.enter_context(patch("agent.models_dev.fetch_models_dev", return_value={}))
        stack.enter_context(
            patch("hermes_cli.models.cached_provider_model_ids", side_effect=_offline_catalog)
        )
        stack.enter_context(patch("hermes_cli.auth._load_auth_store", return_value={}))
        stack.enter_context(patch("agent.credential_pool.load_pool", return_value=_FakePool()))
        stack.enter_context(
            patch("agent.anthropic_adapter.read_hermes_oauth_credentials", return_value=None)
        )
        stack.enter_context(
            patch("agent.anthropic_adapter.read_claude_code_credentials", return_value=cc_creds)
        )
        stack.enter_context(
            patch("agent.anthropic_adapter.is_claude_code_token_valid", return_value=token_valid)
        )
        return list_authenticated_providers(current_provider="openrouter", max_models=50)


def _find_anthropic(providers):
    return next((p for p in providers if p["slug"] == "anthropic"), None)


def test_valid_on_disk_creds_surface_anthropic_with_models():
    # Placeholder token — never a real credential.
    creds = {"accessToken": "sk-ant-oat-TEST", "source": "file"}

    providers = _list_with_cc_creds(creds, token_valid=True)

    anthropic = _find_anthropic(providers)
    assert anthropic is not None
    assert anthropic["total_models"] > 0
    assert any("claude" in m for m in anthropic["models"])


def test_expired_but_refreshable_creds_surface_anthropic():
    creds = {"accessToken": "sk-ant-oat-TEST", "refreshToken": "rt-TEST", "source": "file"}

    providers = _list_with_cc_creds(creds, token_valid=False)

    assert _find_anthropic(providers) is not None


def test_expired_unrefreshable_creds_hide_anthropic():
    # Dead token, no refreshToken -> not usable -> stay hidden.
    creds = {"accessToken": "sk-ant-oat-TEST", "source": "file"}

    providers = _list_with_cc_creds(creds, token_valid=False)

    assert _find_anthropic(providers) is None


def test_no_creds_anywhere_hide_anthropic():
    providers = _list_with_cc_creds(None, token_valid=False)

    assert _find_anthropic(providers) is None
