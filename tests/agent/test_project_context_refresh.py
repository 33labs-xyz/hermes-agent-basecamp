"""Per-turn project context refresh (agent/project_context_refresh.py).

These guard the actual fix for "Projects don't steer the model": project
context is recomputed from the agent's live SessionDB on every turn, so a
long-lived cached agent picks up membership/instruction changes immediately
instead of serving the snapshot it was built with.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from agent.project_context_refresh import (
    append_project_context,
    project_context_for_agent,
)


def _agent(session_db=None, session_id="sess-1"):
    return SimpleNamespace(_session_db=session_db, session_id=session_id)


def test_append_adds_fresh_project_context_to_base_system():
    db = MagicMock()
    db.build_project_context.return_value = "Reply in pirate speak."
    agent = _agent(db)

    result = append_project_context("BASE PROMPT", agent)

    db.build_project_context.assert_called_once_with("sess-1")
    assert result == "BASE PROMPT\n\nReply in pirate speak."


def test_append_is_noop_when_ungrouped():
    db = MagicMock()
    db.build_project_context.return_value = ""
    agent = _agent(db)

    assert append_project_context("BASE PROMPT", agent) == "BASE PROMPT"


def test_append_returns_project_context_when_base_is_empty():
    db = MagicMock()
    db.build_project_context.return_value = "Reply in pirate speak."
    agent = _agent(db)

    assert append_project_context("", agent) == "Reply in pirate speak."


def test_recomputes_every_call_so_changes_take_effect_immediately():
    """The whole point: a cached agent must reflect the CURRENT db value, not
    a value captured once at build time."""
    db = MagicMock()
    agent = _agent(db)

    db.build_project_context.return_value = ""
    assert append_project_context("BASE", agent) == "BASE"  # not yet in a project

    db.build_project_context.return_value = "Reply in pirate speak."
    assert append_project_context("BASE", agent) == "BASE\n\nReply in pirate speak."

    db.build_project_context.return_value = "Reply in formal English."
    assert append_project_context("BASE", agent) == "BASE\n\nReply in formal English."


def test_missing_session_db_or_id_resolves_to_blank():
    assert project_context_for_agent(_agent(session_db=None)) == ""
    assert project_context_for_agent(_agent(db := MagicMock(), session_id="")) == ""
    db.build_project_context.assert_not_called()


def test_build_failure_resolves_to_blank_and_never_breaks_the_turn():
    db = MagicMock()
    db.build_project_context.side_effect = RuntimeError("db gone")
    agent = _agent(db)

    assert append_project_context("BASE", agent) == "BASE"
