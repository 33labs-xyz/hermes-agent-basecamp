"""Tests for POST /api/internal/tool-call (Stage 2 MCP bridge groundwork)."""

import pytest


class TestInternalToolCallEndpoint:
    """Test the FastAPI REST endpoint using Starlette TestClient."""

    @pytest.fixture(autouse=True)
    def _setup_test_client(self, monkeypatch, _isolate_hermes_home):
        """Create a TestClient and isolate the state DB under the test HERMES_HOME."""
        try:
            from starlette.testclient import TestClient
        except ImportError:
            pytest.skip("fastapi/starlette not installed")

        import hermes_state
        from hermes_constants import get_hermes_home
        from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

        monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", get_hermes_home() / "state.db")

        self.client = TestClient(app)
        self.client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN

    # 1. No token registered for the session -> 403.
    def test_tool_call_rejected_without_valid_token(self):
        resp = self.client.post(
            "/api/internal/tool-call",
            json={"session_id": "sess-x", "tool_name": "read_file",
                  "arguments": {}, "bridge_token": "bogus"},
        )
        assert resp.status_code == 403

    # 2. Valid token -> dispatches and wraps a successful result.
    def test_tool_call_with_valid_token_returns_ok_envelope(self, monkeypatch):
        from hermes_cli import web_server
        from hermes_cli.bridge_tokens import register_bridge_token, revoke_bridge_token
        register_bridge_token("sess-ok", "tok-ok")
        monkeypatch.setattr(
            web_server, "handle_function_call",
            lambda name, args, **kw: '{"content": "dummy ok"}',
        )
        try:
            resp = self.client.post(
                "/api/internal/tool-call",
                json={"session_id": "sess-ok", "tool_name": "dummy",
                      "arguments": {"a": 1}, "bridge_token": "tok-ok"},
            )
            assert resp.status_code == 200
            body = resp.json()
            assert body["ok"] is True
            assert body["error"] is None
            assert body["result"] == '{"content": "dummy ok"}'
        finally:
            revoke_bridge_token("sess-ok")

    # 3. Valid token, but the tool result is an error payload -> ok False, error set.
    def test_tool_call_maps_error_payload_to_failure_envelope(self, monkeypatch):
        from hermes_cli import web_server
        from hermes_cli.bridge_tokens import register_bridge_token, revoke_bridge_token
        register_bridge_token("sess-err", "tok-err")
        monkeypatch.setattr(
            web_server, "handle_function_call",
            lambda name, args, **kw: '{"error": "Unknown tool: nope"}',
        )
        try:
            resp = self.client.post(
                "/api/internal/tool-call",
                json={"session_id": "sess-err", "tool_name": "nope",
                      "arguments": {}, "bridge_token": "tok-err"},
            )
            assert resp.status_code == 200
            body = resp.json()
            assert body["ok"] is False
            assert body["error"] == "Unknown tool: nope"
        finally:
            revoke_bridge_token("sess-err")

    # 4. A successful dispatch fires the gateway tool-card emitter (spy, no tui_gateway coupling).
    def test_tool_call_emits_gateway_tool_event(self, monkeypatch):
        from hermes_cli import web_server
        from hermes_cli.bridge_tokens import register_bridge_token, revoke_bridge_token
        register_bridge_token("sess-ev", "tok-ev")
        monkeypatch.setattr(
            web_server, "handle_function_call",
            lambda name, args, **kw: '{"content": "ok"}',
        )
        calls = []
        monkeypatch.setattr(
            web_server, "_emit_bridge_tool_event",
            lambda *a, **k: calls.append((a, k)),
        )
        try:
            resp = self.client.post(
                "/api/internal/tool-call",
                json={"session_id": "sess-ev", "tool_name": "dummy",
                      "arguments": {}, "bridge_token": "tok-ev"},
            )
            assert resp.status_code == 200
            assert len(calls) == 1          # emitter invoked exactly once
        finally:
            revoke_bridge_token("sess-ev")

    # 5. GET tool-schemas: no valid token -> 403 (same guard as the POST endpoint).
    def test_tool_schemas_rejected_without_valid_token(self):
        resp = self.client.get(
            "/api/internal/tool-schemas",
            params={"session_id": "sess-x", "bridge_token": "bogus"},
        )
        assert resp.status_code == 403

    # 6. GET tool-schemas: valid token -> returns only the function schemas, unwrapped.
    def test_tool_schemas_with_valid_token_returns_functions(self, monkeypatch):
        from hermes_cli import web_server
        from hermes_cli.bridge_tokens import register_bridge_token, revoke_bridge_token
        register_bridge_token("sess-sc", "tok-sc")
        monkeypatch.setattr(
            web_server, "get_tool_definitions",
            lambda **kw: [
                {"type": "function", "function": {
                    "name": "read_file", "description": "Read a file",
                    "parameters": {"type": "object", "properties": {}}}},
                {"type": "other", "function": {"name": "ignore_me"}},
            ],
        )
        try:
            resp = self.client.get(
                "/api/internal/tool-schemas",
                params={"session_id": "sess-sc", "bridge_token": "tok-sc"},
            )
            assert resp.status_code == 200
            tools = resp.json()["tools"]
            assert len(tools) == 1                 # non-function entry filtered out
            assert tools[0]["name"] == "read_file"
        finally:
            revoke_bridge_token("sess-sc")
