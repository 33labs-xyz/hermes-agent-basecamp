"""Tests for the streaming-stale escalation policy (stale_stream_guard).

The streaming poll loop in ``chat_completion_helpers`` kills and rebuilds the
provider connection when a stream goes silent (SSE keep-alive pings arrive but
no real chunks). That kill is a best-effort cross-thread socket ``shutdown``,
not a guarantee: if the worker thread's blocked read never unblocks, the loop
would re-detect the stall and re-kill forever, never surfacing an error and
never releasing the gateway's per-session busy flag.

``advance_stale_escalation`` is the pure decision function that bounds those
reconnect attempts. These tests pin its escalation policy without threads,
sockets, or wall-clock time.
"""

import pytest

from agent.stale_stream_guard import (
    DEFAULT_MAX_STALE_KILLS,
    StaleEscalation,
    advance_stale_escalation,
)


def test_default_max_stale_kills_is_three():
    # Arrange / Act / Assert - guards the shipped default the loop relies on.
    assert DEFAULT_MAX_STALE_KILLS == 3


def test_not_stale_from_fresh_state_returns_none():
    # Arrange
    state = StaleEscalation()

    # Act
    new_state, action = advance_stale_escalation(
        state, is_stale=False, made_progress=False, now=10.0, max_kills=3
    )

    # Assert
    assert action == "none"
    assert new_state == StaleEscalation()


def test_first_stale_returns_kill_and_stamps_first_stale_at():
    # Arrange
    state = StaleEscalation()

    # Act
    new_state, action = advance_stale_escalation(
        state, is_stale=True, made_progress=False, now=100.0, max_kills=3
    )

    # Assert
    assert action == "kill"
    assert new_state.kill_count == 1
    assert new_state.first_stale_at == 100.0


def test_consecutive_stales_escalate_to_abort_at_max_kills():
    # Arrange - three stale ticks with no forward progress.
    state = StaleEscalation()
    actions = []

    # Act
    for tick in range(3):
        state, action = advance_stale_escalation(
            state, is_stale=True, made_progress=False, now=float(tick * 200), max_kills=3
        )
        actions.append(action)

    # Assert - kill, kill, then abort on the third once the budget is spent.
    assert actions == ["kill", "kill", "abort"]
    assert state.kill_count == 3


def test_not_stale_after_a_kill_preserves_the_kill_count():
    # Arrange - one kill already recorded; the post-kill quiet window is NOT
    # forward progress, so it must not reset the budget (the crux of the bug:
    # a naive "not stale -> reset" would let the loop kill forever).
    state = StaleEscalation(kill_count=1, first_stale_at=0.0)

    # Act
    new_state, action = advance_stale_escalation(
        state, is_stale=False, made_progress=False, now=50.0, max_kills=3
    )

    # Assert
    assert action == "none"
    assert new_state.kill_count == 1
    assert new_state.first_stale_at == 0.0


def test_made_progress_resets_the_kill_budget():
    # Arrange - two kills recorded, then the worker delivers a real chunk.
    state = StaleEscalation(kill_count=2, first_stale_at=0.0)

    # Act
    new_state, action = advance_stale_escalation(
        state, is_stale=False, made_progress=True, now=90.0, max_kills=3
    )

    # Assert - budget fully reset; a recovered stream is not penalised.
    assert action == "none"
    assert new_state == StaleEscalation()


def test_progress_and_stale_same_tick_recounts_from_one():
    # Arrange - budget nearly spent, but the worker made progress on the same
    # tick it went stale again. Progress must win: recount from 1, not abort.
    state = StaleEscalation(kill_count=2, first_stale_at=0.0)

    # Act
    new_state, action = advance_stale_escalation(
        state, is_stale=True, made_progress=True, now=500.0, max_kills=3
    )

    # Assert
    assert action == "kill"
    assert new_state.kill_count == 1
    assert new_state.first_stale_at == 500.0


def test_hard_ceiling_aborts_before_max_kills_is_reached():
    # Arrange - generous kill budget, but a wall-clock backstop of 300s.
    state = StaleEscalation()
    state, first_action = advance_stale_escalation(
        state, is_stale=True, made_progress=False, now=0.0, max_kills=99, hard_ceiling=300.0
    )

    # Act - second stale detection lands past the ceiling.
    state, second_action = advance_stale_escalation(
        state, is_stale=True, made_progress=False, now=350.0, max_kills=99, hard_ceiling=300.0
    )

    # Assert
    assert first_action == "kill"
    assert second_action == "abort"


def test_max_kills_below_one_raises_value_error():
    # Arrange / Act / Assert
    with pytest.raises(ValueError):
        advance_stale_escalation(
            StaleEscalation(), is_stale=True, made_progress=False, now=0.0, max_kills=0
        )
