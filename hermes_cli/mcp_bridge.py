"""Stdio MCP bridge exposing hermes' native tools to a `claude` CLI turn.

Stage 2 of the Claude (subscription) provider. A `claude` turn is spawned with
`--mcp-config <path>`; that config tells the CLI to launch THIS module as a stdio
MCP server (a separate process). When the CLI's model calls one of the exposed
tools, the bridge forwards the call over localhost HTTP to the hermes backend's
POST /api/internal/tool-call, which runs the real tool and returns the result.
Tool schemas are fetched once at startup from GET /api/internal/tool-schemas.
Every request carries a per-session bridge token so the backend rejects any other
local process.

`--gateway-url` is the hermes BACKEND / dashboard HTTP base URL (host:port that
serves the endpoints above, e.g. http://127.0.0.1:8765). It is NOT
hermes_cli/gateway.py and NOT the tui_gateway/ package; "gateway" here just means
"the local hermes web server this bridge talks to".
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from typing import Any, Callable, Optional

import httpx

logger = logging.getLogger("hermes.mcp_bridge")

# Tool calls (terminal, web, delegation) can be slow; keep a generous ceiling so a
# legitimate long tool does not get cut off, while still bounding a dead backend.
_HTTP_TIMEOUT = httpx.Timeout(120.0)

def _fetch_tool_schemas(base_url: str, session_id: str, token: str) -> list[dict]:
    """GET the hermes tool catalog. Returns the list of function-schema dicts
    ({"name","description","parameters"}). Raises on transport / HTTP failure so
    the bridge fails fast at startup with a clear stderr message."""
    url = base_url.rstrip("/") + "/api/internal/tool-schemas"
    params = {"session_id": session_id, "bridge_token": token}
    with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
        resp = client.get(url, params=params)
    resp.raise_for_status()
    data = resp.json()
    tools = data.get("tools") if isinstance(data, dict) else None
    return tools if isinstance(tools, list) else []

def _post_tool_call(
    base_url: str, session_id: str, token: str, tool_name: str, arguments: dict
) -> dict:
    """POST one tool call to the backend. Returns the {ok,result,error} envelope.
    On any transport error, non-200, or non-JSON response, synthesizes a failure
    envelope whose `result` is a JSON string carrying the error, so the model
    always receives a readable tool result instead of a silent hang."""
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

def _make_handler(
    tool_name: str, base_url: str, session_id: str, token: str
) -> Callable[..., str]:
    """Build the FastMCP tool callable for one tool. It takes the model's keyword
    arguments, forwards them to the backend, and returns the tool's raw result
    string (the same JSON string hermes hands its own model)."""
    def _dispatch(**kwargs: Any) -> str:
        env = _post_tool_call(base_url, session_id, token, tool_name, kwargs or {})
        result = env.get("result")
        if isinstance(result, str):
            return result
        # Backend contract says result is always a string; never hand the model None.
        return json.dumps({"error": env.get("error") or "empty result", "tool": tool_name})

    _dispatch.__name__ = tool_name
    _dispatch.__doc__ = f"hermes {tool_name} tool"
    return _dispatch

def _register_tools(
    mcp: Any, schemas: list[dict], base_url: str, session_id: str, token: str
) -> int:
    """Register each schema as an MCP tool on `mcp`. Returns the count added.
    Mirrors agent/transports/hermes_tools_mcp_server.py: add_tool() with a
    decorator-style fallback for older mcp SDK signatures. Malformed entries
    (not a dict, or missing name) are skipped."""
    count = 0
    for spec in schemas:
        if not isinstance(spec, dict):
            continue
        name = spec.get("name")
        if not name:
            continue
        description = spec.get("description") or f"hermes {name} tool"
        handler = _make_handler(name, base_url, session_id, token)
        try:
            mcp.add_tool(handler, name=name, description=description)
        except TypeError:
            handler = mcp.tool(name=name, description=description)(handler)
        count += 1
    return count

def _build_server(base_url: str, session_id: str, token: str) -> Any:
    """Fetch schemas and construct the FastMCP server with every hermes tool
    attached. Lazy-imports FastMCP so the module imports without the mcp package
    (the tests exercise the seams directly)."""
    try:
        from mcp.server.fastmcp import FastMCP
    except ImportError as exc:  # pragma: no cover - install hint
        raise ImportError(
            f"hermes MCP bridge requires the 'mcp' package: {exc}"
        ) from exc

    schemas = _fetch_tool_schemas(base_url, session_id, token)
    mcp = FastMCP(
        "hermes-bridge",
        instructions=(
            "hermes' native tool surface, exposed to this Claude session. Use these "
            "tools for file access, terminal/shell, web, memory, and every other "
            "capability hermes provides."
        ),
    )
    added = _register_tools(mcp, schemas, base_url, session_id, token)
    logger.info("hermes MCP bridge registered %d tools", added)
    return mcp

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
        server.run()
    except KeyboardInterrupt:
        return 0
    except Exception as exc:
        logger.exception("hermes MCP bridge crashed")
        sys.stderr.write(f"hermes MCP bridge error: {exc}\n")
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
