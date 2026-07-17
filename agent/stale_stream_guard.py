"""Bounded escalation policy for stale streaming API calls.

The streaming poll loop in :mod:`agent.chat_completion_helpers` kills and
rebuilds the provider connection when a stream goes silent (SSE keep-alive
pings arrive but no real chunks). That kill is a best-effort cross-thread
socket ``shutdown`` - a request, not a guarantee. If the worker thread's
blocked read never unblocks (dead/half-open TCP, an SSL layer swallowing the
shutdown), the loop would re-detect the stall and re-kill forever, never
surfacing an error and never releasing the gateway's per-session busy flag.

This module holds the pure decision logic that bounds those reconnect
attempts. After a configurable number of consecutive kills with no forward
progress - or a wall-clock backstop - the loop escalates to a
``TimeoutError`` and exits, mirroring the non-streaming stale path. Kept
side-effect-free so the policy is unit-testable without threads, sockets, or
wall-clock time.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

# Consecutive stale-kills tolerated before the loop gives up and raises.
DEFAULT_MAX_STALE_KILLS = 3


@dataclass(frozen=True)
class StaleEscalation:
    """Immutable escalation state for a single streaming API call.

    ``kill_count`` is the number of consecutive stale-kills since the last
    forward progress. ``first_stale_at`` is the timestamp of the first stale
    detection in the current run of kills (``None`` before any stale tick),
    used to enforce the wall-clock backstop.
    """

    kill_count: int = 0
    first_stale_at: Optional[float] = None


def advance_stale_escalation(
    state: StaleEscalation,
    *,
    is_stale: bool,
    made_progress: bool,
    now: float,
    max_kills: int = DEFAULT_MAX_STALE_KILLS,
    hard_ceiling: Optional[float] = None,
) -> Tuple[StaleEscalation, str]:
    """Advance the escalation state by one poll tick. Pure.

    Returns ``(new_state, action)`` where ``action`` is one of:

    * ``"none"``  - nothing to do this tick.
    * ``"kill"``  - stale detected; kill the connection and let the worker
      attempt a reconnect (still within budget).
    * ``"abort"`` - the kill budget (or the wall-clock ceiling) is exhausted;
      surface a ``TimeoutError`` and stop polling.

    ``made_progress`` means the worker advanced the stream since our last
    kill; it always resets the budget so a stream that recovers is never
    penalised for earlier stalls. A quiet window that is merely *not stale*
    (e.g. the brief lull right after a kill) does NOT reset the budget - only
    genuine progress does. ``max_kills`` must be >= 1.
    """
    if max_kills < 1:
        raise ValueError("max_kills must be >= 1")

    # Genuine forward progress wipes the slate: the stream is healthy again.
    if made_progress:
        state = StaleEscalation()

    if not is_stale:
        return state, "none"

    first_stale_at = state.first_stale_at if state.first_stale_at is not None else now
    kill_count = state.kill_count + 1
    new_state = StaleEscalation(kill_count=kill_count, first_stale_at=first_stale_at)

    ceiling_hit = hard_ceiling is not None and (now - first_stale_at) >= hard_ceiling
    if kill_count >= max_kills or ceiling_hit:
        return new_state, "abort"
    return new_state, "kill"
