import threading
import time
from pathlib import Path

import pytest

from agent.chat_completion_helpers import build_api_kwargs, interruptible_api_call
from agent.transports.claude_cli import (
    ClaudeCliTransport,
    _active_turns,
    begin_turn,
    end_turn,
    run_claude_cli_turn,
)

FAKE = str(Path(__file__).parent / "fixtures" / "fake_claude.sh")
SLOW_FAKE = str(Path(__file__).parent / "fixtures" / "fake_claude_slow.sh")

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
