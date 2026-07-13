import json
import os
import sys
import threading
import time
from pathlib import Path

import pytest

import agent.transports.claude_cli as claude_cli_transport
from agent.chat_completion_helpers import (
    build_api_kwargs,
    interruptible_api_call,
    interruptible_streaming_api_call,
)
from agent.transports.claude_cli import (
    ClaudeCliTransport,
    _active_turns,
    begin_turn,
    end_turn,
    run_claude_cli_turn,
)
from hermes_cli.bridge_tokens import verify_bridge_token

FAKE = str(Path(__file__).parent / "fixtures" / "fake_claude.sh")
SLOW_FAKE = str(Path(__file__).parent / "fixtures" / "fake_claude_slow.sh")
MCP_FAKE = str(Path(__file__).parent / "fixtures" / "fake_claude_mcp.sh")

def _kwargs(model="claude-cli/sonnet"):
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "hi"},
        ],
        "hermes_session_id": "sess-1",
    }

class TestTransport:
    def test_api_mode(self):
        assert ClaudeCliTransport().api_mode == "claude_cli"

    def test_turn_returns_normalized_response(self, monkeypatch):
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE)
        resp = run_claude_cli_turn(_kwargs())
        assert resp.content == "Hello world"
        assert resp.tool_calls is None
        assert resp.finish_reason == "stop"

    def test_model_prefix_stripped(self, monkeypatch):
        # claude-cli/sonnet -> CLI receives bare "sonnet"
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE)
        resp = run_claude_cli_turn(_kwargs("claude-cli/opus"))
        assert resp.finish_reason == "stop"

    def test_missing_cli_yields_error_response(self, monkeypatch):
        monkeypatch.setenv("CLAUDE_CLI_PATH", "/nonexistent/claude")
        monkeypatch.setenv("PATH", "/nonexistent")
        resp = run_claude_cli_turn(_kwargs())
        assert resp.finish_reason == "error"
        assert "claude login" in (resp.content or "").lower() or "not found" in (resp.content or "").lower()

    def test_end_turn_is_compare_and_delete(self):
        # Simulates: turn A registers, then (before A's delayed cleanup
        # runs) turn B registers under the same session_key. A's late
        # end_turn must not clobber B's still-active entry.
        turn_a = object()
        turn_b = object()
        key = "sess-race"

        begin_turn(key, turn_a)
        begin_turn(key, turn_b)
        end_turn(key, turn_a)
        assert _active_turns.get(key) is turn_b

        end_turn(key, turn_b)
        assert _active_turns.get(key) is None

    def test_build_kwargs_reads_only_hermes_session_id(self):
        transport = ClaudeCliTransport()
        messages = [{"role": "user", "content": "hi"}]

        # The old session_id key alone no longer drives session mapping.
        legacy_only = transport.build_kwargs(
            "claude-cli/sonnet", messages, session_id="legacy-should-be-ignored"
        )
        assert legacy_only["hermes_session_id"] is None

        canonical = transport.build_kwargs(
            "claude-cli/sonnet",
            messages,
            session_id="legacy-should-be-ignored",
            hermes_session_id="sess-canonical",
        )
        assert canonical["hermes_session_id"] == "sess-canonical"


class _FakeClaudeCliAgent:
    """Minimal real (non-Mock) stand-in for AIAgent, scoped to exactly the
    attributes interruptible_api_call() and build_api_kwargs() read for
    api_mode == "claude_cli".

    A real object rather than a MagicMock: MagicMock auto-vivifies any
    attribute access instead of raising AttributeError, which would
    silently defeat the getattr(..., default) probes in
    _is_openai_codex_backend() and could make the numeric watchdog
    comparisons behave unpredictably. A real object also keeps the
    interrupt test's thread timing realistic.
    """

    def __init__(self, session_id: str):
        self.api_mode = "claude_cli"
        self.model = "claude-cli/sonnet"
        self.session_id = session_id
        self.tools = None
        self._interrupt_requested = False
        self._codex_on_first_delta = None

    def _get_transport(self):
        return ClaudeCliTransport()

    def _compute_non_stream_stale_timeout(self, api_kwargs):
        # Generous on purpose: keeps the stale-call watchdog from firing
        # before the interrupt test's deliberate interrupt does.
        return 60.0

    def _touch_activity(self, _message):
        return None

    def _buffer_status(self, _message):
        return None


class TestDispatchWiring:
    """Task 3: claude_cli routed through the interruptible API-call path.

    Covers the three edit sites: build_api_kwargs() (session-id key
    selection), the _call() dispatch branch inside interruptible_api_call(),
    and the interrupt handler that must kill the CLI subprocess group
    instead of touching an HTTP client.
    """

    def test_build_api_kwargs_routes_claude_cli_to_hermes_session_id(self):
        # Task 2 fix commit 241ec9462 made the transport read ONLY
        # hermes_session_id (no session_id fallback). If build_api_kwargs
        # ever regresses to the generic session_id= key here, CLI session
        # continuity and interruptibility silently break.
        agent = _FakeClaudeCliAgent(session_id="sess-build-kwargs")

        kwargs = build_api_kwargs(agent, [{"role": "user", "content": "hi"}])

        assert kwargs["hermes_session_id"] == "sess-build-kwargs"
        assert "session_id" not in kwargs

    def test_interruptible_api_call_returns_cli_content(self, monkeypatch):
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE)
        agent = _FakeClaudeCliAgent(session_id="sess-dispatch-content")
        api_kwargs = {**_kwargs(), "hermes_session_id": agent.session_id}

        resp = interruptible_api_call(agent, api_kwargs)

        assert resp.content == "Hello world"
        assert resp.tool_calls is None
        assert resp.finish_reason == "stop"

    def test_interrupt_kills_inflight_cli_subprocess(self, monkeypatch):
        # Regression guard: interruptible_api_call must kill the underlying
        # `claude` subprocess via interrupt_turn() rather than waiting out
        # the fixture's 30s sleep.
        monkeypatch.setenv("CLAUDE_CLI_PATH", SLOW_FAKE)
        agent = _FakeClaudeCliAgent(session_id="sess-dispatch-interrupt")
        api_kwargs = {**_kwargs(), "hermes_session_id": agent.session_id}

        outcome: dict = {}

        def _run():
            try:
                outcome["response"] = interruptible_api_call(agent, api_kwargs)
            except InterruptedError as exc:
                outcome["error"] = exc

        worker = threading.Thread(target=_run, daemon=True)
        worker.start()

        # Let the fake CLI actually start and emit its init line before
        # interrupting, so this exercises a genuine in-flight kill rather
        # than racing subprocess start-up.
        time.sleep(0.5)
        t_interrupt = time.time()
        agent._interrupt_requested = True

        worker.join(timeout=10.0)
        elapsed_since_interrupt = time.time() - t_interrupt

        assert not worker.is_alive(), (
            "interruptible_api_call did not return after interrupt "
            "(fixture sleeps 30s, the CLI subprocess was not killed)"
        )
        assert elapsed_since_interrupt < 5.0, (
            f"interrupt took {elapsed_since_interrupt:.1f}s after the flag "
            "flipped, should be near-instant, not the fixture's 30s sleep"
        )
        assert "error" in outcome
        assert isinstance(outcome["error"], InterruptedError)

    def test_stale_watchdog_kills_inflight_cli_subprocess(self, monkeypatch):
        # Important-finding regression guard: interruptible_api_call has TWO
        # force-stop blocks - the interrupt handler above (already correct)
        # and the stale-call watchdog (this one). Before this fix the
        # watchdog's try block had no claude_cli branch, so
        # _close_request_client_once() was a no-op for claude_cli (no OpenAI
        # request_client is ever set for this provider), and
        # run_claude_cli_turn() returns a NormalizedResponse rather than
        # raising, so the killed turn looked like a silent success while the
        # CLI subprocess kept running, unkilled, in the background.
        monkeypatch.setenv("CLAUDE_CLI_PATH", SLOW_FAKE)
        agent = _FakeClaudeCliAgent(session_id="sess-dispatch-stale-timeout")
        # Tiny stale threshold so the watchdog fires almost immediately,
        # instead of the interrupt test's deliberately generous 60.0s.
        agent._compute_non_stream_stale_timeout = lambda api_kwargs: 0.5
        api_kwargs = {**_kwargs(), "hermes_session_id": agent.session_id}

        t_start = time.time()
        with pytest.raises(TimeoutError):
            interruptible_api_call(agent, api_kwargs)
        elapsed = time.time() - t_start

        assert elapsed < 5.0, (
            f"stale watchdog took {elapsed:.1f}s to raise, should kill the "
            "subprocess well under the fixture's 30s sleep, not wait it out"
        )
        assert agent.session_id not in _active_turns, (
            "stale watchdog left the CLI subprocess registered as in-flight "
            "(interrupt_turn() was not reached for claude_cli, so the "
            "subprocess group was never actually killed)"
        )

    def test_streaming_dispatch_delegates_without_touching_openai_client(self, monkeypatch):
        # finding-B: interruptible_streaming_api_call had no claude_cli
        # branch before this fix, so a streaming claude_cli turn (the
        # dashboard's default path - conversation_loop defaults
        # _use_streaming=True with no claude_cli exclusion) fell into the
        # generic branch and crashed building an OpenAI client claude_cli
        # never has. _FakeClaudeCliAgent deliberately defines no
        # _create_request_openai_client / _ensure_primary_openai_client
        # (unlike MagicMock, a plain object raises AttributeError instead
        # of silently auto-vivifying), so this test fails loudly if the
        # streaming dispatch ever regresses to that generic branch.
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE)
        agent = _FakeClaudeCliAgent(session_id="sess-streaming-dispatch")
        agent._interruptible_api_call = lambda kwargs: interruptible_api_call(agent, kwargs)
        api_kwargs = {**_kwargs(), "hermes_session_id": agent.session_id}
        first_delta_calls = {"count": 0}

        resp = interruptible_streaming_api_call(
            agent, api_kwargs,
            on_first_delta=lambda: first_delta_calls.__setitem__(
                "count", first_delta_calls["count"] + 1
            ),
        )

        assert resp.content == "Hello world"
        assert resp.finish_reason == "stop"
        # FAKE emits two text deltas; on_first_delta must fire once, on the
        # first of them, same as the codex_responses hand-off contract.
        assert first_delta_calls["count"] == 1
        # Hand-off is a per-call scratch attribute - must not leak into
        # whatever the next call on this agent turns out to be.
        assert agent._codex_on_first_delta is None

    def test_streaming_dispatch_hands_off_on_first_delta_and_clears_it(self):
        agent = _FakeClaudeCliAgent(session_id="sess-streaming-handoff")
        api_kwargs = {**_kwargs(), "hermes_session_id": agent.session_id}
        captured = {}

        def _fake_interruptible_api_call(kwargs):
            captured["kwargs"] = kwargs
            captured["on_first_delta_during_call"] = agent._codex_on_first_delta
            return "sentinel-response"

        agent._interruptible_api_call = _fake_interruptible_api_call
        on_first_delta = lambda: None

        result = interruptible_streaming_api_call(
            agent, api_kwargs, on_first_delta=on_first_delta
        )

        assert result == "sentinel-response"
        assert captured["kwargs"] is api_kwargs
        assert captured["on_first_delta_during_call"] is on_first_delta
        assert agent._codex_on_first_delta is None


class TestResolveGatewayBaseUrl:
    """_resolve_gateway_base_url() combines the two existing web_server.py
    normalization precedents: wildcard-bind -> loopback (_maybe_open_browser)
    and IPv6-literal bracket-wrapping (_build_gateway_ws_url /
    _build_sidecar_url). Exercised against the real FastAPI app's app.state,
    monkeypatched per test rather than actually binding a socket.
    """

    @pytest.fixture()
    def web_server_app(self):
        from hermes_cli.web_server import app
        return app

    def test_returns_none_when_never_bound(self, monkeypatch, web_server_app):
        monkeypatch.setattr(web_server_app.state, "bound_host", None, raising=False)
        monkeypatch.setattr(web_server_app.state, "bound_port", None, raising=False)
        assert claude_cli_transport._resolve_gateway_base_url() is None

    def test_returns_none_when_web_server_import_fails(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "hermes_cli.web_server", None)
        assert claude_cli_transport._resolve_gateway_base_url() is None

    def test_passes_through_ordinary_ipv4_host(self, monkeypatch, web_server_app):
        monkeypatch.setattr(web_server_app.state, "bound_host", "127.0.0.1", raising=False)
        monkeypatch.setattr(web_server_app.state, "bound_port", 8080, raising=False)
        assert claude_cli_transport._resolve_gateway_base_url() == "http://127.0.0.1:8080"

    def test_normalizes_wildcard_ipv4_to_loopback(self, monkeypatch, web_server_app):
        monkeypatch.setattr(web_server_app.state, "bound_host", "0.0.0.0", raising=False)
        monkeypatch.setattr(web_server_app.state, "bound_port", 8765, raising=False)
        assert claude_cli_transport._resolve_gateway_base_url() == "http://127.0.0.1:8765"

    def test_normalizes_wildcard_ipv6_to_loopback(self, monkeypatch, web_server_app):
        monkeypatch.setattr(web_server_app.state, "bound_host", "::", raising=False)
        monkeypatch.setattr(web_server_app.state, "bound_port", 8765, raising=False)
        assert claude_cli_transport._resolve_gateway_base_url() == "http://127.0.0.1:8765"

    def test_bracket_wraps_a_real_ipv6_bind(self, monkeypatch, web_server_app):
        monkeypatch.setattr(web_server_app.state, "bound_host", "::1", raising=False)
        monkeypatch.setattr(web_server_app.state, "bound_port", 8765, raising=False)
        assert claude_cli_transport._resolve_gateway_base_url() == "http://[::1]:8765"


class TestMcpBridge:
    """Task 8: per-turn ephemeral MCP config wires hermes' tools into the
    CLI via hermes_cli/mcp_bridge.py. _resolve_gateway_base_url is
    monkeypatched to a fixed URL so these tests never depend on an actual
    dashboard web server running in this process.
    """

    def test_tool_event_forwarded_and_final_text_lands_in_content(self, monkeypatch):
        monkeypatch.setenv("CLAUDE_CLI_PATH", MCP_FAKE)
        monkeypatch.setattr(
            claude_cli_transport, "_resolve_gateway_base_url",
            lambda: "http://127.0.0.1:9999",
        )
        events = []

        resp = run_claude_cli_turn(
            _kwargs(), on_tool_event=lambda event: events.append(event)
        )

        assert resp.content == "Used the bridge tool."
        assert resp.finish_reason == "stop"
        # Both the tool_use (assistant) and tool_result (user) events are
        # forwarded verbatim by ClaudeCliTurn._handle_event.
        assert len(events) == 2
        assert events[0]["type"] == "assistant"
        assert events[0]["message"]["content"][0]["name"] == "mcp__basecamp__web_search"
        assert events[1]["type"] == "user"

    def test_config_file_written_with_token_and_deleted_after_turn(self, monkeypatch):
        monkeypatch.setenv("CLAUDE_CLI_PATH", MCP_FAKE)
        monkeypatch.setattr(
            claude_cli_transport, "_resolve_gateway_base_url",
            lambda: "http://127.0.0.1:9999",
        )
        real_write = claude_cli_transport._write_mcp_config
        written = {}

        def _spy_write(hermes_session_id, token, base_url):
            path = real_write(hermes_session_id, token, base_url)
            with open(path) as fh:
                written["config"] = json.load(fh)
            written["path"] = path
            written["token"] = token
            return path

        monkeypatch.setattr(claude_cli_transport, "_write_mcp_config", _spy_write)

        resp = run_claude_cli_turn(_kwargs())

        assert resp.finish_reason == "stop"
        args = written["config"]["mcpServers"]["basecamp"]["args"]
        assert args[args.index("--bridge-token") + 1] == written["token"]
        assert args[args.index("--session-id") + 1] == "sess-1"
        assert args[args.index("--gateway-url") + 1] == "http://127.0.0.1:9999"
        assert written["config"]["mcpServers"]["basecamp"]["command"] == sys.executable
        assert not os.path.exists(written["path"]), (
            "MCP config temp file must be deleted once the turn ends"
        )

    def test_register_and_revoke_bridge_token_around_the_turn(self, monkeypatch):
        monkeypatch.setenv("CLAUDE_CLI_PATH", MCP_FAKE)
        monkeypatch.setattr(
            claude_cli_transport, "_resolve_gateway_base_url",
            lambda: "http://127.0.0.1:9999",
        )
        monkeypatch.setattr(
            claude_cli_transport.secrets, "token_urlsafe",
            lambda n: "deterministic-test-token",
        )

        session_key = "sess-token-lifecycle"
        assert verify_bridge_token(session_key, "deterministic-test-token") is False

        events = []
        resp = run_claude_cli_turn(
            {**_kwargs(), "hermes_session_id": session_key},
            on_tool_event=lambda event: events.append(event),
        )

        assert resp.finish_reason == "stop"
        # The fake CLI echoes the token it read out of --mcp-config back on
        # the assistant event - proves the token registered before spawn is
        # the one actually written to disk and used by the subprocess.
        assert events[0]["hermes_test_token"] == "deterministic-test-token"
        # And revoked once the turn (and its cleanup) has fully returned.
        assert verify_bridge_token(session_key, "deterministic-test-token") is False

    def test_failed_config_write_revokes_token_and_leaves_no_temp_file(self, monkeypatch):
        # A write failure mid-config (disk full / quota) must not leak
        # either half of the bridge state: the token stays out of the
        # registry and the half-created temp file is removed, while the
        # turn still runs (degraded to Stage-1, no tools) rather than
        # crashing. Patches the real json.dump so the real _write_mcp_config
        # creates a NamedTemporaryFile and then fails writing to it.
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE)
        monkeypatch.setattr(
            claude_cli_transport, "_resolve_gateway_base_url",
            lambda: "http://127.0.0.1:9999",
        )
        monkeypatch.setattr(
            claude_cli_transport.secrets, "token_urlsafe",
            lambda n: "doomed-write-token",
        )

        created_paths = []
        real_named_tmp = claude_cli_transport.tempfile.NamedTemporaryFile

        def _tracking_tmp(*args, **kwargs):
            handle = real_named_tmp(*args, **kwargs)
            created_paths.append(handle.name)
            return handle

        def _boom_dump(*args, **kwargs):
            raise OSError("disk full")

        monkeypatch.setattr(
            claude_cli_transport.tempfile, "NamedTemporaryFile", _tracking_tmp
        )
        monkeypatch.setattr(claude_cli_transport.json, "dump", _boom_dump)

        session_key = "sess-failed-write"
        resp = run_claude_cli_turn(
            {**_kwargs(), "hermes_session_id": session_key}
        )

        # Degrades to a normal Stage-1 turn rather than crashing.
        assert resp.content == "Hello world"
        assert resp.finish_reason == "stop"
        # The token never stayed registered.
        assert verify_bridge_token(session_key, "doomed-write-token") is False
        # The half-written temp file was cleaned up, not orphaned on disk.
        assert created_paths, "expected _write_mcp_config to create a temp file"
        for path in created_paths:
            assert not os.path.exists(path), (
                "a failed config write must not orphan its temp file on disk"
            )

    def test_no_gateway_available_runs_without_mcp_bridge(self, monkeypatch):
        # Graceful degradation: _resolve_gateway_base_url returning None
        # (no dashboard web server running in this process) must not
        # crash the turn - it just runs with no tools, same as Stage 1.
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE)
        monkeypatch.setattr(
            claude_cli_transport, "_resolve_gateway_base_url", lambda: None
        )

        resp = run_claude_cli_turn(_kwargs())

        assert resp.content == "Hello world"
        assert resp.finish_reason == "stop"

    def test_enable_tools_false_skips_the_mcp_bridge(self, monkeypatch):
        # handle_max_iterations() passes enable_tools=False for a
        # text-only summary turn; the bridge must not be prepared at all,
        # even when a gateway is available.
        monkeypatch.setenv("CLAUDE_CLI_PATH", FAKE)
        calls = {"count": 0}

        def _fail_if_called():
            calls["count"] += 1
            return "http://127.0.0.1:9999"

        monkeypatch.setattr(
            claude_cli_transport, "_resolve_gateway_base_url", _fail_if_called
        )

        resp = run_claude_cli_turn(_kwargs(), enable_tools=False)

        assert resp.content == "Hello world"
        assert calls["count"] == 0, (
            "enable_tools=False must skip _prepare_mcp_bridge entirely, "
            "not just discard its result"
        )
