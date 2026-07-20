"""Server-side Composio client for one-click staff tool connections.

Two modes, chosen by which environment variable is set on the backend
process (never sent to or read from the Electron renderer):

- **direct** (``COMPOSIO_API_KEY`` set): talks straight to the Composio REST
  API. Single-user desktop install; every connected account belongs to one
  owner (``COMPOSIO_USER_ID``). This is the original behavior, kept for
  back-compat with installs that already have connections under it.
- **relay** (``BASECAMP_RELAY_URL`` set, no ``COMPOSIO_API_KEY``): talks to
  our hosted relay service instead, so end users don't need their own
  Composio key. The relay scopes connections by a per-install id
  (``install_id``) instead of the fixed ``"default"`` user.

Direct wins when both are set. When neither is set, ``is_configured()`` is
False and the staff routes fall back to the manual MCP connection path.

Each mode wraps the same three operations: find-or-mint a hosted connect
link, check whether a connection is active, and resolve the MCP server URL
the agent runtime should load for a connected toolkit.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

COMPOSIO_BASE_URL = "https://backend.composio.dev/api/v3"

# Single-user desktop app in direct mode: every connected account belongs to
# one owner.
COMPOSIO_USER_ID = "default"

_HTTP_TIMEOUT_SECONDS = 15.0

_INSTALL_ID_PREFIX = "bc"
_INSTALL_ID_HEX_CHARS = 30


class ComposioError(RuntimeError):
    """Any failure talking to the Composio API or relay (network, auth, bad payload)."""


def _settings_env_value(name: str) -> Optional[str]:
    """Read a value straight from the Settings ``.env`` at HERMES_HOME.

    The pasted-in-Settings key is authoritative: the dashboard process writes
    it to ``.env`` via ``save_env_value``, but long-lived subprocesses (e.g.
    ``tui_gateway.slash_worker``) keep their boot-time ``os.environ`` snapshot
    and never see the save. Reading the file at call time makes the key the
    user pasted the one Basecamp actually references, regardless of any stale
    snapshot a worker still holds. Returns None if the file is missing,
    unreadable, or has no such entry.
    """
    try:
        from hermes_constants import get_hermes_home

        env_path = get_hermes_home() / ".env"
        text = env_path.read_text(encoding="utf-8")
    except (OSError, ImportError):
        return None

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key.strip() == name:
            value = value.strip()
            return value or None
    return None


def api_key() -> Optional[str]:
    # Settings file wins over any stale os.environ snapshot a worker holds.
    key = _settings_env_value("COMPOSIO_API_KEY")
    if key:
        return key
    key = os.environ.get("COMPOSIO_API_KEY", "").strip()
    return key or None


def relay_base_url() -> Optional[str]:
    url = os.environ.get("BASECAMP_RELAY_URL", "").strip()
    return url.rstrip("/") or None


def mode() -> str:
    """"direct", "relay", or "none" — see module docstring for precedence."""
    if api_key() is not None:
        return "direct"
    if relay_base_url() is not None:
        return "relay"
    return "none"


def is_configured() -> bool:
    return mode() != "none"


def _request(
    method: str,
    path: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    key = api_key()
    if not key:
        raise ComposioError("COMPOSIO_API_KEY is not set")

    import httpx

    try:
        response = httpx.request(
            method,
            f"{COMPOSIO_BASE_URL}{path}",
            params=params,
            json=json_body,
            headers={"x-api-key": key},
            timeout=_HTTP_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise ComposioError(f"Composio request failed: {exc}") from exc

    if response.status_code >= 400:
        raise ComposioError(f"Composio API returned {response.status_code} for {method} {path}")

    try:
        data = response.json()
    except ValueError as exc:
        raise ComposioError("Composio returned a non-JSON response") from exc
    if not isinstance(data, dict):
        raise ComposioError("Composio returned an unexpected response shape")
    return data


def _auth_config_id(toolkit: str) -> str:
    """Return an auth config id for the toolkit, creating a managed one if needed."""
    existing = _request("GET", "/auth_configs", params={"toolkit_slug": toolkit})
    for item in existing.get("items") or []:
        config_id = item.get("id") if isinstance(item, dict) else None
        if config_id:
            return str(config_id)

    created = _request(
        "POST",
        "/auth_configs",
        json_body={
            "toolkit": {"slug": toolkit},
            "auth_config": {"type": "use_composio_managed_auth", "name": f"Basecamp {toolkit}"},
        },
    )
    config = created.get("auth_config") if isinstance(created.get("auth_config"), dict) else created
    config_id = config.get("id")
    if not config_id:
        raise ComposioError(f"Composio did not return an auth config id for {toolkit}")
    return str(config_id)


def _direct_connect_link(toolkit: str) -> str:
    data = _request(
        "POST",
        "/connected_accounts/link",
        json_body={"auth_config_id": _auth_config_id(toolkit), "user_id": COMPOSIO_USER_ID},
    )
    url = data.get("redirect_url") or data.get("redirectUrl")
    if not url:
        raise ComposioError(f"Composio did not return a connect link for {toolkit}")
    return str(url)


def _direct_connection_active(toolkit: str) -> bool:
    data = _request(
        "GET",
        "/connected_accounts",
        params={"toolkit_slugs": toolkit, "user_ids": COMPOSIO_USER_ID, "statuses": "ACTIVE"},
    )
    return bool(data.get("items"))


def _mcp_server_url_with_user(base_url: Optional[str], toolkit: str, user_id: str) -> str:
    if not base_url:
        raise ComposioError(f"Composio did not return an mcp url for {toolkit}")
    return f"{base_url}?user_id={user_id}"


def _direct_mcp_url(toolkit: str) -> str:
    """Find or create the Composio-hosted MCP server for a toolkit.

    Composio's MCP servers are named resources independent of connected
    accounts — an ACTIVE connection doesn't automatically get one. Reuse an
    existing ``basecamp-<toolkit>`` server if present, otherwise create one
    scoped to the toolkit's auth config.
    """
    server_name = f"basecamp-{toolkit}"
    existing = _request("GET", "/mcp/servers")
    for item in existing.get("items") or []:
        if isinstance(item, dict) and item.get("name") == server_name:
            return _mcp_server_url_with_user(item.get("mcp_url"), toolkit, COMPOSIO_USER_ID)

    created = _request(
        "POST",
        "/mcp/servers",
        json_body={"name": server_name, "auth_config_ids": [_auth_config_id(toolkit)]},
    )
    return _mcp_server_url_with_user(created.get("mcp_url"), toolkit, COMPOSIO_USER_ID)


def _relay_request(
    method: str,
    path: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    base = relay_base_url()
    if not base:
        raise ComposioError("BASECAMP_RELAY_URL is not set")

    import httpx

    try:
        response = httpx.request(
            method,
            f"{base}{path}",
            params=params,
            json=json_body,
            timeout=_HTTP_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise ComposioError(f"Relay request failed: {exc}") from exc

    if response.status_code >= 400:
        raise ComposioError(_relay_error_message(response, method, path))

    try:
        data = response.json()
    except ValueError as exc:
        raise ComposioError("Relay returned a non-JSON response") from exc
    if not isinstance(data, dict):
        raise ComposioError("Relay returned an unexpected response shape")
    return data


def _relay_error_message(response: Any, method: str, path: str) -> str:
    try:
        data = response.json()
    except ValueError:
        return f"Relay returned {response.status_code} for {method} {path}"
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            if message:
                return str(message)
    return f"Relay returned {response.status_code} for {method} {path}"


def _relay_connect_link(toolkit: str) -> str:
    data = _relay_request(
        "POST",
        "/api/v1/composio/connect",
        json_body={"toolkit": toolkit, "user_id": install_id()},
    )
    url = data.get("connect_url")
    if not url:
        raise ComposioError(f"Relay did not return a connect url for {toolkit}")
    return str(url)


def _relay_connection_active(toolkit: str) -> bool:
    data = _relay_request(
        "GET",
        "/api/v1/composio/status",
        params={"toolkit": toolkit, "user_id": install_id()},
    )
    return bool(data.get("active"))


def _relay_mcp_url(toolkit: str) -> str:
    data = _relay_request(
        "POST",
        "/api/v1/composio/mcp-url",
        json_body={"toolkit": toolkit, "user_id": install_id()},
    )
    url = data.get("mcp_url")
    if not url:
        raise ComposioError(f"Relay did not return an mcp url for {toolkit}")
    return str(url)


def connect_link(toolkit: str) -> str:
    """Mint a hosted connect link the user opens in their browser."""
    if mode() == "relay":
        return _relay_connect_link(toolkit)
    return _direct_connect_link(toolkit)


def connection_active(toolkit: str) -> bool:
    """True when the user has an ACTIVE connected account for the toolkit."""
    if mode() == "relay":
        return _relay_connection_active(toolkit)
    return _direct_connection_active(toolkit)


def mcp_url(toolkit: str) -> str:
    """Resolve the MCP server URL the agent runtime should load for a
    connected toolkit (see ``tools/mcp_tool.py``, which loads url-based
    servers from ``config.yaml``)."""
    if mode() == "relay":
        return _relay_mcp_url(toolkit)
    return _direct_mcp_url(toolkit)


def _install_id_path() -> Path:
    """Same directory resolution as the staff state file
    (``hermes_cli.staff.routes._state_path``): ``~/.hermes/staff/``."""
    return Path(os.path.expanduser("~/.hermes")) / "staff" / "install_id"


def install_id() -> str:
    """Stable per-install identifier used as the relay's ``user_id``.

    Created once on first call and persisted to disk; immutable afterward so
    the relay recognizes returning installs across process restarts.
    """
    path = _install_id_path()
    try:
        existing = path.read_text(encoding="utf-8").strip()
    except OSError:
        existing = ""
    if existing:
        return existing

    new_id = _INSTALL_ID_PREFIX + uuid.uuid4().hex[:_INSTALL_ID_HEX_CHARS]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(new_id, encoding="utf-8")
    return new_id
