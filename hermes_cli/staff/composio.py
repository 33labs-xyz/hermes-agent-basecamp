"""Server-side Composio client for one-click staff tool connections.

Wraps the three Composio REST calls the staff marketplace needs: find or
create a Composio-managed auth config for a toolkit, mint a hosted connect
link (the user finishes OAuth in their browser, credentials never touch this
app), and check whether an active connected account exists.

The API key comes exclusively from the ``COMPOSIO_API_KEY`` environment
variable on the backend process — it is never sent to or read from the
Electron renderer. When the key is absent the staff routes fall back to the
manual MCP connection path.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

COMPOSIO_BASE_URL = "https://backend.composio.dev/api/v3"

# Single-user desktop app: every connected account belongs to one owner.
COMPOSIO_USER_ID = "default"

_HTTP_TIMEOUT_SECONDS = 15.0


class ComposioError(RuntimeError):
    """Any failure talking to the Composio API (network, auth, bad payload)."""


def api_key() -> Optional[str]:
    key = os.environ.get("COMPOSIO_API_KEY", "").strip()
    return key or None


def is_configured() -> bool:
    return api_key() is not None


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


def connect_link(toolkit: str) -> str:
    """Mint a hosted connect link the user opens in their browser."""
    data = _request(
        "POST",
        "/connected_accounts/link",
        json_body={"auth_config_id": _auth_config_id(toolkit), "user_id": COMPOSIO_USER_ID},
    )
    url = data.get("redirect_url") or data.get("redirectUrl")
    if not url:
        raise ComposioError(f"Composio did not return a connect link for {toolkit}")
    return str(url)


def connection_active(toolkit: str) -> bool:
    """True when the user has an ACTIVE connected account for the toolkit."""
    data = _request(
        "GET",
        "/connected_accounts",
        params={"toolkit_slugs": toolkit, "user_ids": COMPOSIO_USER_ID, "statuses": "ACTIVE"},
    )
    return bool(data.get("items"))
