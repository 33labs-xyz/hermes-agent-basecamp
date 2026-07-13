"""Tests for the stdio MCP bridge seams (Stage 2, Claude subscription)."""

import json


def test_fetch_tool_schemas_returns_tools_list(monkeypatch):
    from hermes_cli import mcp_bridge

    class FakeResp:
        status_code = 200
        def raise_for_status(self): pass
        def json(self): return {"tools": [
            {"name": "read_file", "description": "d", "parameters": {"type": "object"}}]}

    class FakeClient:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, *a, **k): return FakeResp()

    monkeypatch.setattr(mcp_bridge.httpx, "Client", FakeClient)
    tools = mcp_bridge._fetch_tool_schemas("http://127.0.0.1:9999", "s", "t")
    assert tools == [{"name": "read_file", "description": "d", "parameters": {"type": "object"}}]


def test_handler_forwards_call_and_returns_result_string(monkeypatch):
    from hermes_cli import mcp_bridge
    captured = {}

    def fake_post(base_url, session_id, token, tool_name, arguments):
        captured.update(base=base_url, sess=session_id, tok=token,
                        name=tool_name, args=arguments)
        return {"ok": True, "result": '{"content": "hi"}', "error": None}

    monkeypatch.setattr(mcp_bridge, "_post_tool_call", fake_post)
    handler = mcp_bridge._make_handler("read_file", "http://127.0.0.1:9999", "sess-1", "tok-1")
    out = handler(path="README.md")
    assert out == '{"content": "hi"}'          # raw tool result string passed through
    assert captured["name"] == "read_file"
    assert captured["args"] == {"path": "README.md"}
    assert captured["sess"] == "sess-1" and captured["tok"] == "tok-1"


def test_register_tools_adds_one_tool_per_schema():
    from hermes_cli import mcp_bridge

    class StubMCP:
        def __init__(self): self.added = []
        def add_tool(self, fn, name=None, description=None):
            self.added.append((name, description))

    mcp = StubMCP()
    schemas = [
        {"name": "read_file", "description": "Read a file", "parameters": {"type": "object"}},
        {"name": "terminal", "description": "Run a command", "parameters": {"type": "object"}},
        {"not_a": "tool"},                       # malformed entry is skipped
    ]
    count = mcp_bridge._register_tools(mcp, schemas, "http://127.0.0.1:9999", "s", "t")
    assert count == 2
    assert [n for n, _ in mcp.added] == ["read_file", "terminal"]


def test_post_tool_call_synthesizes_error_envelope_on_http_failure(monkeypatch):
    from hermes_cli import mcp_bridge

    class FakeResp:
        status_code = 500
        def json(self): raise ValueError("no json")

    class FakeClient:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, *a, **k): return FakeResp()

    monkeypatch.setattr(mcp_bridge.httpx, "Client", FakeClient)
    env = mcp_bridge._post_tool_call("http://127.0.0.1:9999", "s", "t", "read_file", {})
    assert env["ok"] is False
    assert env["error"]                          # human-readable error present
    assert json.loads(env["result"])["error"]    # result is a JSON string the model can read
