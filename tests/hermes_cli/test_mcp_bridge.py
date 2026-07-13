"""Tests for the stdio MCP bridge (Stage 2, Claude subscription).

Two layers:
  1. mcp-free seam tests (schema fetch, spec normalization, dispatch, error
     envelopes) that run without the `mcp` package installed.
  2. real-`mcp` tests (importorskip) that build the actual low-level Server and
     drive its list_tools / call_tool handlers, proving the model sees each
     tool's REAL JSON schema and that raw arguments reach the backend verbatim.
     These are the regression tests for the two review Criticals:
       - Finding 1: FastMCP advertised a useless {"kwargs": string} schema so no
         tool was callable. The low-level Server must advertise spec.parameters.
       - Finding 2: the bridge token must never appear in a URL/query string or
         in any error message printed to stderr.
"""

import asyncio
import json

import pytest


# ---------------------------------------------------------------------------
# Seam tests (no `mcp` package needed)
# ---------------------------------------------------------------------------

def test_fetch_tool_schemas_returns_tools_list(monkeypatch):
    from hermes_cli import mcp_bridge

    class FakeResp:
        status_code = 200
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


def test_fetch_tool_schemas_sends_token_as_header_not_query(monkeypatch):
    """Finding 2: the bridge token must travel in the X-Bridge-Token header,
    never in the request URL or query params (which get logged)."""
    from hermes_cli import mcp_bridge
    seen = {}

    class FakeResp:
        status_code = 200
        def json(self): return {"tools": []}

    class FakeClient:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, url, params=None, headers=None, **k):
            seen["url"] = url
            seen["params"] = params or {}
            seen["headers"] = headers or {}
            return FakeResp()

    monkeypatch.setattr(mcp_bridge.httpx, "Client", FakeClient)
    mcp_bridge._fetch_tool_schemas("http://127.0.0.1:9999", "sess-1", "secret-token")

    assert seen["headers"].get("X-Bridge-Token") == "secret-token"
    assert "secret-token" not in seen["url"]
    assert "secret-token" not in json.dumps(seen["params"])
    assert "bridge_token" not in seen["params"]          # not a query param at all


def test_fetch_tool_schemas_http_error_leaks_neither_token_nor_url(monkeypatch):
    """Finding 2: a non-200 must raise a message with no token, no URL, no query."""
    from hermes_cli import mcp_bridge

    class FakeResp:
        status_code = 403
        def json(self): return {}

    class FakeClient:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, *a, **k): return FakeResp()

    monkeypatch.setattr(mcp_bridge.httpx, "Client", FakeClient)
    with pytest.raises(RuntimeError) as ei:
        mcp_bridge._fetch_tool_schemas("http://127.0.0.1:9999", "sess-1", "secret-token")
    msg = str(ei.value)
    assert "secret-token" not in msg
    assert "http://127.0.0.1:9999" not in msg
    assert "sess-1" not in msg
    assert "403" in msg


def test_fetch_tool_schemas_transport_error_sanitized(monkeypatch):
    """Finding 2: a transport error (whose native str embeds the URL) must be
    replaced by a sanitized RuntimeError carrying neither URL nor token."""
    from hermes_cli import mcp_bridge

    class FakeClient:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, *a, **k):
            raise RuntimeError("connect error to http://127.0.0.1:9999?bridge_token=secret-token")

    monkeypatch.setattr(mcp_bridge.httpx, "Client", FakeClient)
    with pytest.raises(RuntimeError) as ei:
        mcp_bridge._fetch_tool_schemas("http://127.0.0.1:9999", "sess-1", "secret-token")
    msg = str(ei.value)
    assert "secret-token" not in msg
    assert "http://127.0.0.1:9999" not in msg


def test_build_tool_specs_keeps_real_schema_and_skips_malformed():
    from hermes_cli import mcp_bridge
    real_params = {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}
    schemas = [
        {"name": "read_file", "description": "Read a file", "parameters": real_params},
        {"name": "terminal", "parameters": {"type": "object"}},   # description defaulted
        {"name": "no_params"},                                    # missing parameters -> neutral
        {"not_a": "tool"},                                        # malformed -> skipped
        "garbage",                                                # non-dict -> skipped
        {"description": "nameless"},                              # missing name -> skipped
    ]
    specs = mcp_bridge._build_tool_specs(schemas)
    names = [n for (n, _d, _s) in specs]
    assert names == ["read_file", "terminal", "no_params"]

    by_name = {n: (d, s) for (n, d, s) in specs}
    # The real per-tool schema is preserved verbatim (this is what fixes Finding 1).
    assert by_name["read_file"][1] == real_params
    assert by_name["terminal"][0] == "hermes terminal tool"       # defaulted description
    assert by_name["no_params"][1] == {"type": "object", "properties": {}}


def test_dispatch_tool_forwards_args_and_returns_result_string(monkeypatch):
    from hermes_cli import mcp_bridge
    captured = {}

    def fake_post(base_url, session_id, token, tool_name, arguments):
        captured.update(base=base_url, sess=session_id, tok=token,
                        name=tool_name, args=arguments)
        return {"ok": True, "result": '{"content": "hi"}', "error": None}

    monkeypatch.setattr(mcp_bridge, "_post_tool_call", fake_post)
    out = mcp_bridge._dispatch_tool("http://127.0.0.1:9999", "sess-1", "tok-1",
                                    "read_file", {"path": "README.md"})
    assert out == '{"content": "hi"}'                             # raw tool result passed through
    assert captured["name"] == "read_file"
    assert captured["args"] == {"path": "README.md"}
    assert captured["sess"] == "sess-1" and captured["tok"] == "tok-1"


def test_dispatch_tool_never_returns_none_when_result_missing(monkeypatch):
    from hermes_cli import mcp_bridge

    def fake_post(*a, **k):
        return {"ok": False, "result": None, "error": "boom"}

    monkeypatch.setattr(mcp_bridge, "_post_tool_call", fake_post)
    out = mcp_bridge._dispatch_tool("http://x", "s", "t", "read_file", {})
    assert isinstance(out, str)
    assert json.loads(out)["error"] == "boom"


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


# ---------------------------------------------------------------------------
# Real-`mcp` tests: build the actual low-level Server and drive its handlers.
# These would FAIL against the old FastMCP implementation (Finding 1).
# ---------------------------------------------------------------------------

def test_build_server_advertises_real_inputschema(monkeypatch):
    """Regression test for Finding 1: list_tools must advertise each tool's real
    JSON schema, not a generic {"kwargs": string} wrapper."""
    pytest.importorskip("mcp")
    import mcp.types as types
    from hermes_cli import mcp_bridge

    real_params = {
        "type": "object",
        "properties": {"path": {"type": "string"}, "limit": {"type": "integer"}},
        "required": ["path"],
    }
    monkeypatch.setattr(
        mcp_bridge, "_fetch_tool_schemas",
        lambda *a, **k: [{"name": "read_file", "description": "Read a file", "parameters": real_params}],
    )

    server = mcp_bridge._build_server("http://127.0.0.1:9999", "sess-1", "tok-1")

    handler = server.request_handlers[types.ListToolsRequest]
    result = asyncio.run(handler(types.ListToolsRequest(method="tools/list")))
    tool = result.root.tools[0]
    assert tool.name == "read_file"
    assert tool.inputSchema == real_params                 # NOT {"kwargs": ...}
    assert "kwargs" not in tool.inputSchema.get("properties", {})


def test_build_server_call_tool_forwards_raw_arguments(monkeypatch):
    """Regression test for Finding 1: call_tool must forward the model's real
    arguments dict verbatim to the backend, and return the result string."""
    pytest.importorskip("mcp")
    import mcp.types as types
    from hermes_cli import mcp_bridge

    monkeypatch.setattr(
        mcp_bridge, "_fetch_tool_schemas",
        lambda *a, **k: [{"name": "read_file", "description": "d",
                          "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}}],
    )
    captured = {}

    def fake_post(base_url, session_id, token, tool_name, arguments):
        captured.update(name=tool_name, args=arguments, tok=token)
        return {"ok": True, "result": '{"content":"file bytes"}', "error": None}

    monkeypatch.setattr(mcp_bridge, "_post_tool_call", fake_post)

    server = mcp_bridge._build_server("http://127.0.0.1:9999", "sess-1", "tok-1")
    handler = server.request_handlers[types.CallToolRequest]
    req = types.CallToolRequest(
        method="tools/call",
        params=types.CallToolRequestParams(name="read_file", arguments={"path": "/etc/hosts"}),
    )
    result = asyncio.run(handler(req))

    assert captured["name"] == "read_file"
    assert captured["args"] == {"path": "/etc/hosts"}      # raw args reached backend verbatim
    assert captured["tok"] == "tok-1"
    assert result.root.content[0].text == '{"content":"file bytes"}'
