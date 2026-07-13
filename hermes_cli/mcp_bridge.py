"""Stdio MCP bridge exposing hermes' native tools to a `claude` CLI turn.

Stage 2 of the Claude (subscription) provider. A `claude` turn is spawned with
`--mcp-config <path>`; that config tells the CLI to launch THIS module as a stdio
MCP server (a separate process). When the CLI's model calls one of the exposed
tools, the bridge forwards the call over localhost HTTP to the hermes backend's
POST /api/internal/tool-call, which runs the real tool and returns the result.
Tool schemas are fetched once at startup from GET /api/internal/tool-schemas.
Every request carries a per-session bridge token so the backend rejects any other
local process. The token travels in the POST body and in an `X-Bridge-Token`
header (never in a URL/query string, so it cannot leak into request logs).

`--gateway-url` is the hermes BACKEND / dashboard HTTP base URL (host:port that
serves the endpoints above, e.g. http://127.0.0.1:8765). It is NOT
hermes_cli/gateway.py and NOT the tui_gateway/ package; "gateway" here just means
"the local hermes web server this bridge talks to".

Implementation note: this uses the low-level `mcp.server.lowlevel.Server`, not
the FastMCP convenience wrapper. FastMCP builds each tool's advertised
inputSchema by introspecting the Python handler's SIGNATURE, so a generic
`**kwargs` proxy handler advertises a useless `{"kwargs": string}` schema and the
model can never call any tool. The low-level Server advertises the real
per-tool JSON schema verbatim and hands the raw arguments dict straight to the
dispatch handler, which is exactly what a schema-passthrough proxy needs.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from typing import Any, Optional

import httpx

logger = logging.getLogger("hermes.mcp_bridge")

# Tool calls (terminal, web, delegation) can be slow; keep a generous ceiling so a
# legitimate long tool does not get cut off, while still bounding a dead backend.
_HTTP_TIMEOUT = httpx.Timeout(120.0)


def _fetch_tool_schemas(base_url: str, session_id: str, token: str) -> list[dict]:
    """GET the hermes tool catalog. Returns the list of function-schema dicts
    ({"name","description","parameters"}).

    The bridge token is sent in the `X-Bridge-Token` header, never in the URL, so
    it cannot leak into server access logs or exception strings. On any transport
    or HTTP failure this raises a RuntimeError whose message carries only a status
    code and a fixed description (no URL, no query string, no token) so the bridge
    fails fast at startup without ever printing the secret to stderr."""
    url = base_url.rstrip("/") + "/api/internal/tool-schemas"
    params = {"session_id": session_id}  # session_id is not secret; token is header-only
    headers = {"X-Bridge-Token": token}
    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
            resp = client.get(url, params=params, headers=headers)
    except Exception as exc:
        # Never surface the raw exception: httpx errors embed the request URL, and
        # we keep the bridge token (and full URL) out of every log line.
        raise RuntimeError(
            "bridge could not reach hermes backend to fetch tool schemas "
            f"({type(exc).__name__})"
        ) from None
    if resp.status_code != 200:
        # Status code + fixed message only — no URL, no query string, no token.
        raise RuntimeError(
            f"hermes backend returned HTTP {resp.status_code} fetching tool schemas"
        )
    try:
        data = resp.json()
    except (ValueError, TypeError):
        raise RuntimeError("hermes backend returned non-JSON tool schemas") from None
    tools = data.get("tools") if isinstance(data, dict) else None
    return tools if isinstance(tools, list) else []


def _post_tool_call(
    base_url: str, session_id: str, token: str, tool_name: str, arguments: dict
) -> dict:
    """POST one tool call to the backend. Returns the {ok,result,error} envelope.
    On any transport error, non-200, or non-JSON response, synthesizes a failure
    envelope whose `result` is a JSON string carrying the error, so the model
    always receives a readable tool result instead of a silent hang. The token
    travels in the POST body, not the URL."""
    url = base_url.rstrip("/") + "/api/internal/tool-call"
    payload = {
        "session_id": session_id,
        "tool_name": tool_name,
        "arguments": arguments or {},
        "bridge_token": token,
    }
    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
            resp = client.post(url, json=payload)
    except Exception as exc:
        msg = f"bridge could not reach hermes backend: {exc}"
        return {"ok": False, "result": json.dumps({"error": msg}), "error": msg}

    if resp.status_code != 200:
        msg = f"hermes backend returned HTTP {resp.status_code} for tool {tool_name}"
        return {"ok": False, "result": json.dumps({"error": msg}), "error": msg}

    try:
        env = resp.json()
    except (ValueError, TypeError):
        msg = f"hermes backend returned non-JSON for tool {tool_name}"
        return {"ok": False, "result": json.dumps({"error": msg}), "error": msg}

    if not isinstance(env, dict):
        msg = f"hermes backend returned unexpected payload for tool {tool_name}"
        return {"ok": False, "result": json.dumps({"error": msg}), "error": msg}
    return env


def _build_tool_specs(schemas: list[dict]) -> list[tuple[str, str, dict]]:
    """Normalize fetched schemas into (name, description, input_schema) tuples.
    Malformed entries (not a dict, or missing name) are skipped. `input_schema`
    is the tool's real JSON-Schema `parameters` object — advertised verbatim to
    the model. No `mcp` dependency, so this seam is unit-testable directly."""
    specs: list[tuple[str, str, dict]] = []
    for spec in schemas:
        if not isinstance(spec, dict):
            continue
        name = spec.get("name")
        if not name:
            continue
        description = spec.get("description") or f"hermes {name} tool"
        input_schema = spec.get("parameters")
        if not isinstance(input_schema, dict):
            input_schema = {"type": "object", "properties": {}}
        specs.append((name, description, input_schema))
    return specs


def _dispatch_tool(
    base_url: str, session_id: str, token: str, tool_name: str, arguments: dict
) -> str:
    """Forward one tool call and return the raw result STRING for the model (the
    same JSON string hermes hands its own model). Never returns None. No `mcp`
    dependency, so this seam is unit-testable directly."""
    env = _post_tool_call(base_url, session_id, token, tool_name, arguments or {})
    result = env.get("result")
    if isinstance(result, str):
        return result
    # Backend contract says result is always a string; never hand the model None.
    return json.dumps({"error": env.get("error") or "empty result", "tool": tool_name})


def _build_server(base_url: str, session_id: str, token: str) -> Any:
    """Fetch schemas and construct the low-level MCP Server with every hermes tool
    attached. Lazy-imports the `mcp` package so the module imports without it (the
    unit tests exercise the seams directly). Advertises each tool's real JSON
    schema via list_tools, and forwards call_tool's raw arguments dict to the
    backend."""
    try:
        from mcp.server.lowlevel import Server
        import mcp.types as types
    except ImportError as exc:  # pragma: no cover - install hint
        raise ImportError(
            f"hermes MCP bridge requires the 'mcp' package: {exc}"
        ) from exc

    schemas = _fetch_tool_schemas(base_url, session_id, token)
    specs = _build_tool_specs(schemas)

    server = Server(
        "hermes-bridge",
        instructions=(
            "hermes' native tool surface, exposed to this Claude session. Use these "
            "tools for file access, terminal/shell, web, memory, and every other "
            "capability hermes provides."
        ),
    )

    @server.list_tools()
    async def _list_tools() -> list[Any]:
        # Advertise the real per-tool JSON schema verbatim so the model can call
        # each tool with its true parameters.
        return [
            types.Tool(name=name, description=description, inputSchema=input_schema)
            for (name, description, input_schema) in specs
        ]

    # validate_input=False: the hermes backend's handle_function_call is the
    # authoritative validator. Double-validating here (against jsonschema) risks
    # rejecting a call the real tool would accept; forward raw and let the backend
    # decide, always returning a readable result either way.
    @server.call_tool(validate_input=False)
    async def _call_tool(name: str, arguments: dict) -> list[Any]:
        import anyio

        # Offload the blocking HTTP forward to a worker thread so a slow tool
        # (terminal, web) never freezes the stdio MCP protocol loop.
        result_str = await anyio.to_thread.run_sync(
            _dispatch_tool, base_url, session_id, token, name, arguments or {}
        )
        return [types.TextContent(type="text", text=result_str)]

    logger.info("hermes MCP bridge registered %d tools", len(specs))
    return server


def _run_server(server: Any) -> None:
    """Drive the low-level Server over stdio until the client disconnects."""
    import anyio
    from mcp.server.stdio import stdio_server

    async def _arun() -> None:
        async with stdio_server() as (read_stream, write_stream):
            await server.run(
                read_stream, write_stream, server.create_initialization_options()
            )

    anyio.run(_arun)


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="hermes-mcp-bridge")
    parser.add_argument(
        "--gateway-url", required=True,
        help="hermes backend HTTP base URL, e.g. http://127.0.0.1:8765",
    )
    parser.add_argument(
        "--session-id", required=True,
        help="hermes session id the bridge token is registered under",
    )
    parser.add_argument(
        "--bridge-token", required=True,
        help="per-session token presented on every backend call",
    )
    parser.add_argument("--verbose", "-v", action="store_true")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    """Entry point for `python -m hermes_cli.mcp_bridge`."""
    argv = list(sys.argv[1:] if argv is None else argv)
    args = _parse_args(argv)

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        stream=sys.stderr,  # stdout is the MCP wire - logs MUST go to stderr
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    os.environ.setdefault("HERMES_QUIET", "1")
    os.environ.setdefault("HERMES_REDACT_SECRETS", "true")

    try:
        server = _build_server(args.gateway_url, args.session_id, args.bridge_token)
    except ImportError as exc:
        sys.stderr.write(f"hermes MCP bridge cannot start: {exc}\n")
        return 2
    except Exception as exc:
        sys.stderr.write(f"hermes MCP bridge failed to fetch tools: {exc}\n")
        return 1

    try:
        _run_server(server)
    except KeyboardInterrupt:
        return 0
    except Exception as exc:
        logger.exception("hermes MCP bridge crashed")
        sys.stderr.write(f"hermes MCP bridge error: {exc}\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
