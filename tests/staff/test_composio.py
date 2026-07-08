"""Tests for the server-side Composio client used by staff connections.

The HTTP layer is a single injectable function (``_request``); tests replace
it with a fake so no network is touched. The API key comes exclusively from
the ``COMPOSIO_API_KEY`` environment variable — server-side only, never the
renderer.
"""

from __future__ import annotations

import pytest

from hermes_cli.staff import composio


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("COMPOSIO_API_KEY", raising=False)


class FakeRequest:
    """Records calls and replays canned responses keyed by (method, path)."""

    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def __call__(self, method, path, *, params=None, json_body=None):
        self.calls.append({"method": method, "path": path, "params": params, "json_body": json_body})
        key = (method, path)
        if key not in self.responses:
            raise AssertionError(f"unexpected Composio call {key}")
        result = self.responses[key]
        if isinstance(result, Exception):
            raise result
        return result


# -- configuration -----------------------------------------------------------

def test_not_configured_without_env_key():
    assert composio.api_key() is None
    assert composio.is_configured() is False


def test_configured_with_env_key(monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "  ck_test_123  ")
    assert composio.api_key() == "ck_test_123"
    assert composio.is_configured() is True


def test_blank_env_key_is_not_configured(monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "   ")
    assert composio.is_configured() is False


# -- connect_link ------------------------------------------------------------

def test_connect_link_reuses_existing_auth_config(monkeypatch):
    fake = FakeRequest({
        ("GET", "/auth_configs"): {"items": [{"id": "ac_existing"}]},
        ("POST", "/connected_accounts/link"): {"redirect_url": "https://connect.composio.dev/x"},
    })
    monkeypatch.setattr(composio, "_request", fake)

    url = composio.connect_link("gmail")

    assert url == "https://connect.composio.dev/x"
    link_call = next(c for c in fake.calls if c["path"] == "/connected_accounts/link")
    assert link_call["json_body"]["auth_config_id"] == "ac_existing"
    assert link_call["json_body"]["user_id"] == composio.COMPOSIO_USER_ID
    assert not any(c["method"] == "POST" and c["path"] == "/auth_configs" for c in fake.calls)


def test_connect_link_creates_auth_config_when_missing(monkeypatch):
    fake = FakeRequest({
        ("GET", "/auth_configs"): {"items": []},
        ("POST", "/auth_configs"): {"auth_config": {"id": "ac_new"}},
        ("POST", "/connected_accounts/link"): {"redirect_url": "https://connect.composio.dev/y"},
    })
    monkeypatch.setattr(composio, "_request", fake)

    url = composio.connect_link("slack")

    assert url == "https://connect.composio.dev/y"
    create_call = next(c for c in fake.calls if c["method"] == "POST" and c["path"] == "/auth_configs")
    assert create_call["json_body"]["toolkit"]["slug"] == "slack"
    assert create_call["json_body"]["auth_config"]["type"] == "use_composio_managed_auth"
    link_call = next(c for c in fake.calls if c["path"] == "/connected_accounts/link")
    assert link_call["json_body"]["auth_config_id"] == "ac_new"


def test_connect_link_without_redirect_url_raises(monkeypatch):
    fake = FakeRequest({
        ("GET", "/auth_configs"): {"items": [{"id": "ac_1"}]},
        ("POST", "/connected_accounts/link"): {},
    })
    monkeypatch.setattr(composio, "_request", fake)

    with pytest.raises(composio.ComposioError):
        composio.connect_link("gmail")


def test_connect_link_propagates_request_errors(monkeypatch):
    fake = FakeRequest({("GET", "/auth_configs"): composio.ComposioError("boom")})
    monkeypatch.setattr(composio, "_request", fake)

    with pytest.raises(composio.ComposioError):
        composio.connect_link("gmail")


# -- connection_active -------------------------------------------------------

def test_connection_active_true_when_items_returned(monkeypatch):
    fake = FakeRequest({("GET", "/connected_accounts"): {"items": [{"id": "conn_1", "status": "ACTIVE"}]}})
    monkeypatch.setattr(composio, "_request", fake)

    assert composio.connection_active("gmail") is True
    call = fake.calls[0]
    assert call["params"]["toolkit_slugs"] == "gmail"
    assert call["params"]["statuses"] == "ACTIVE"


def test_connection_active_false_when_empty(monkeypatch):
    fake = FakeRequest({("GET", "/connected_accounts"): {"items": []}})
    monkeypatch.setattr(composio, "_request", fake)

    assert composio.connection_active("gmail") is False


# -- _request guardrails -------------------------------------------------------

def test_request_without_key_raises():
    with pytest.raises(composio.ComposioError):
        composio._request("GET", "/auth_configs")
