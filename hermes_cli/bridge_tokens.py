"""Per-session bridge tokens for the internal tool-call endpoint.

A `claude` CLI turn (Stage 2) spawns an stdio MCP bridge that drives hermes'
native tools by POSTing to /api/internal/tool-call. That endpoint must reject
any other local process, so each turn mints a random token, registers it here
keyed by hermes_session_id, and the bridge presents it on every call. Kept as a
tiny standalone module (not web_server.py) so the transport can register a token
without importing the whole FastAPI app.
"""
from __future__ import annotations

import hmac
import threading

_BRIDGE_TOKENS: dict[str, str] = {}
_LOCK = threading.Lock()


def register_bridge_token(session_id: str, token: str) -> None:
    """Store (or replace) the bridge token for a session. Empty args are ignored."""
    if not session_id or not token:
        return
    with _LOCK:
        _BRIDGE_TOKENS[str(session_id)] = str(token)


def verify_bridge_token(session_id: str, token: str) -> bool:
    """Constant-time check that token matches the registered token for session_id."""
    if not session_id or not token:
        return False
    with _LOCK:
        expected = _BRIDGE_TOKENS.get(str(session_id))
    if not expected:
        return False
    return hmac.compare_digest(str(expected), str(token))


def revoke_bridge_token(session_id: str) -> None:
    """Drop a session's token (called when its turn ends). Missing keys are ignored."""
    if not session_id:
        return
    with _LOCK:
        _BRIDGE_TOKENS.pop(str(session_id), None)
