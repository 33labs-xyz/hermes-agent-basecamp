"""Tests for the server-side Composio client used by staff connections.

Two modes: direct (``COMPOSIO_API_KEY`` set, talks straight to the Composio
API) and relay (``BASECAMP_RELAY_URL`` set, talks to our hosted relay so
multi-user apps don't need their own Composio key). Direct wins when both are
set, for back-compat with existing single-user installs.

The HTTP layer in each mode is a single injectable function (``_request`` for
direct, ``_relay_request`` for relay); tests replace them with fakes so no
network is touched.
"""

from __future__ import annotations

import re

import pytest

from hermes_cli.staff import composio


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("COMPOSIO_API_KEY", raising=False)
    monkeypatch.delenv("BASECAMP_RELAY_URL", raising=False)


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


# -- mode precedence -----------------------------------------------------------

def test_mode_none_when_neither_configured():
    assert composio.mode() == "none"
    assert composio.is_configured() is False


def test_mode_direct_when_key_set(monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "ck_test_123")
    assert composio.mode() == "direct"
    assert composio.is_configured() is True


def test_mode_relay_when_only_relay_url_set(monkeypatch):
    monkeypatch.setenv("BASECAMP_RELAY_URL", "https://relay.example.com")
    assert composio.mode() == "relay"
    assert composio.is_configured() is True


def test_mode_direct_wins_when_both_set(monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "ck_test_123")
    monkeypatch.setenv("BASECAMP_RELAY_URL", "https://relay.example.com")
    assert composio.mode() == "direct"


def test_saved_key_activates_direct_mode_without_restart(tmp_path, monkeypatch):
    """Saving the key through the backend flips ``mode()`` to direct live.

    Settings → Keys writes via ``PUT /api/env`` → ``save_env_value``, which
    runs inside the same backend process that serves the staff routes and sets
    ``os.environ`` in-process. Since ``composio.api_key()`` reads ``os.environ``
    directly, the BYOK key takes effect with no backend restart.
    """
    from hermes_cli.config import save_env_value

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    assert composio.mode() == "none"

    save_env_value("COMPOSIO_API_KEY", "ck_live_test")

    assert composio.api_key() == "ck_live_test"
    assert composio.mode() == "direct"


def test_relay_base_url_strips_trailing_slash(monkeypatch):
    monkeypatch.setenv("BASECAMP_RELAY_URL", "https://relay.example.com/")
    assert composio.relay_base_url() == "https://relay.example.com"


def test_relay_base_url_none_when_unset():
    assert composio.relay_base_url() is None


def test_relay_base_url_blank_is_none(monkeypatch):
    monkeypatch.setenv("BASECAMP_RELAY_URL", "   ")
    assert composio.relay_base_url() is None


# -- relay connect_link / connection_active / mcp_url ---------------------------

class FakeRelayRequest:
    """Same recording/replay shape as FakeRequest, for ``_relay_request``."""

    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def __call__(self, method, path, *, params=None, json_body=None):
        self.calls.append({"method": method, "path": path, "params": params, "json_body": json_body})
        key = (method, path)
        if key not in self.responses:
            raise AssertionError(f"unexpected relay call {key}")
        result = self.responses[key]
        if isinstance(result, Exception):
            raise result
        return result


def _relay_mode(monkeypatch, url="https://relay.example.com"):
    monkeypatch.setenv("BASECAMP_RELAY_URL", url)


def test_relay_connect_link_posts_toolkit_and_install_id(monkeypatch):
    _relay_mode(monkeypatch)
    monkeypatch.setattr(composio, "install_id", lambda: "bc-test-install")
    fake = FakeRelayRequest({
        ("POST", "/api/v1/composio/connect"): {"connect_url": "https://relay.example.com/c/1"},
    })
    monkeypatch.setattr(composio, "_relay_request", fake)

    url = composio.connect_link("gmail")

    assert url == "https://relay.example.com/c/1"
    call = fake.calls[0]
    assert call["json_body"] == {"toolkit": "gmail", "user_id": "bc-test-install"}


def test_relay_connect_link_without_url_raises(monkeypatch):
    _relay_mode(monkeypatch)
    monkeypatch.setattr(composio, "install_id", lambda: "bc-test-install")
    fake = FakeRelayRequest({("POST", "/api/v1/composio/connect"): {}})
    monkeypatch.setattr(composio, "_relay_request", fake)

    with pytest.raises(composio.ComposioError):
        composio.connect_link("gmail")


def test_relay_connection_active_true(monkeypatch):
    _relay_mode(monkeypatch)
    monkeypatch.setattr(composio, "install_id", lambda: "bc-test-install")
    fake = FakeRelayRequest({("GET", "/api/v1/composio/status"): {"active": True}})
    monkeypatch.setattr(composio, "_relay_request", fake)

    assert composio.connection_active("gmail") is True
    call = fake.calls[0]
    assert call["params"] == {"toolkit": "gmail", "user_id": "bc-test-install"}


def test_relay_connection_active_false(monkeypatch):
    _relay_mode(monkeypatch)
    monkeypatch.setattr(composio, "install_id", lambda: "bc-test-install")
    fake = FakeRelayRequest({("GET", "/api/v1/composio/status"): {"active": False}})
    monkeypatch.setattr(composio, "_relay_request", fake)

    assert composio.connection_active("gmail") is False


def test_relay_connection_active_propagates_errors(monkeypatch):
    _relay_mode(monkeypatch)
    monkeypatch.setattr(composio, "install_id", lambda: "bc-test-install")
    fake = FakeRelayRequest({("GET", "/api/v1/composio/status"): composio.ComposioError("boom")})
    monkeypatch.setattr(composio, "_relay_request", fake)

    with pytest.raises(composio.ComposioError):
        composio.connection_active("gmail")


def test_relay_mcp_url_returns_relay_value(monkeypatch):
    _relay_mode(monkeypatch)
    monkeypatch.setattr(composio, "install_id", lambda: "bc-test-install")
    mcp_url = "https://backend.composio.dev/v3/mcp/abc?user_id=bc-test-install"
    fake = FakeRelayRequest({("POST", "/api/v1/composio/mcp-url"): {"mcp_url": mcp_url}})
    monkeypatch.setattr(composio, "_relay_request", fake)

    assert composio.mcp_url("gmail") == mcp_url
    call = fake.calls[0]
    assert call["json_body"] == {"toolkit": "gmail", "user_id": "bc-test-install"}


def test_relay_mcp_url_without_url_raises(monkeypatch):
    _relay_mode(monkeypatch)
    monkeypatch.setattr(composio, "install_id", lambda: "bc-test-install")
    fake = FakeRelayRequest({("POST", "/api/v1/composio/mcp-url"): {}})
    monkeypatch.setattr(composio, "_relay_request", fake)

    with pytest.raises(composio.ComposioError):
        composio.mcp_url("gmail")


def test_relay_request_without_base_url_raises():
    with pytest.raises(composio.ComposioError):
        composio._relay_request("GET", "/api/v1/composio/status")


# -- install_id ------------------------------------------------------------

def test_install_id_created_once_and_stable(tmp_path, monkeypatch):
    monkeypatch.setattr(composio, "_install_id_path", lambda: tmp_path / "install_id")

    first = composio.install_id()
    second = composio.install_id()

    assert first == second
    assert (tmp_path / "install_id").read_text(encoding="utf-8").strip() == first


def test_install_id_survives_reread(tmp_path, monkeypatch):
    path = tmp_path / "install_id"
    monkeypatch.setattr(composio, "_install_id_path", lambda: path)
    created = composio.install_id()

    # Simulate a fresh process re-reading the same file from disk.
    monkeypatch.setattr(composio, "_install_id_path", lambda: path)
    assert composio.install_id() == created


def test_install_id_strips_whitespace_on_read(tmp_path, monkeypatch):
    path = tmp_path / "install_id"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("bc123abc  \n", encoding="utf-8")
    monkeypatch.setattr(composio, "_install_id_path", lambda: path)

    assert composio.install_id() == "bc123abc"


def test_install_id_valid_charset(tmp_path, monkeypatch):
    monkeypatch.setattr(composio, "_install_id_path", lambda: tmp_path / "install_id")

    install_id = composio.install_id()

    assert re.match(r"^[A-Za-z0-9_-]{6,64}$", install_id)
    assert install_id.startswith("bc")


# -- direct-mode mcp_url -----------------------------------------------------

def test_direct_mcp_url_finds_existing_server(monkeypatch):
    fake = FakeRequest({
        ("GET", "/mcp/servers"): {
            "items": [{"name": "basecamp-gmail", "mcp_url": "https://backend.composio.dev/v3/mcp/abc"}]
        },
    })
    monkeypatch.setattr(composio, "_request", fake)

    url = composio.mcp_url("gmail")

    assert url == f"https://backend.composio.dev/v3/mcp/abc?user_id={composio.COMPOSIO_USER_ID}"
    assert not any(c["method"] == "POST" and c["path"] == "/mcp/servers" for c in fake.calls)


def test_direct_mcp_url_creates_when_missing(monkeypatch):
    fake = FakeRequest({
        ("GET", "/mcp/servers"): {"items": []},
        ("GET", "/auth_configs"): {"items": [{"id": "ac_existing"}]},
        ("POST", "/mcp/servers"): {"mcp_url": "https://backend.composio.dev/v3/mcp/new"},
    })
    monkeypatch.setattr(composio, "_request", fake)

    url = composio.mcp_url("slack")

    assert url == f"https://backend.composio.dev/v3/mcp/new?user_id={composio.COMPOSIO_USER_ID}"
    create_call = next(c for c in fake.calls if c["method"] == "POST" and c["path"] == "/mcp/servers")
    assert create_call["json_body"]["name"] == "basecamp-slack"
    assert create_call["json_body"]["auth_config_ids"] == ["ac_existing"]


def test_direct_mcp_url_without_url_raises(monkeypatch):
    fake = FakeRequest({
        ("GET", "/mcp/servers"): {"items": []},
        ("GET", "/auth_configs"): {"items": [{"id": "ac_existing"}]},
        ("POST", "/mcp/servers"): {},
    })
    monkeypatch.setattr(composio, "_request", fake)

    with pytest.raises(composio.ComposioError):
        composio.mcp_url("slack")


def test_mcp_url_uses_relay_when_relay_mode(monkeypatch):
    _relay_mode(monkeypatch)
    monkeypatch.setattr(composio, "install_id", lambda: "bc-test-install")
    fake = FakeRelayRequest({
        ("POST", "/api/v1/composio/mcp-url"): {"mcp_url": "https://relay.example.com/mcp/1"},
    })
    monkeypatch.setattr(composio, "_relay_request", fake)
    direct_fake = FakeRequest({})
    monkeypatch.setattr(composio, "_request", direct_fake)

    assert composio.mcp_url("gmail") == "https://relay.example.com/mcp/1"
    assert direct_fake.calls == []
