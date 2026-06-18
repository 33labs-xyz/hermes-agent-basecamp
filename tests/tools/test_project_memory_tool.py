"""Tests for tools/project_memory_tool.py — the agent-facing project memory tool.

The tool resolves the active project from the dispatched ``session_id`` and
opens the default-profile ``SessionDB`` via ``_open_db``. Tests redirect that
to a temp-file DB so they exercise the real store without touching ~/.hermes.
"""

import json
import time

import pytest

from tools.project_memory_tool import (
    project_memory_tool,
    PROJECT_MEMORY_SCHEMA,
    MEMORY_ENTRY_MAX,
)


@pytest.fixture
def db(tmp_path):
    from hermes_state import SessionDB

    return SessionDB(db_path=tmp_path / "pm_state.db")


@pytest.fixture(autouse=True)
def _redirect_open_db(monkeypatch, db):
    # The tool closes the db it opens, so hand it a fresh handle to the same
    # file on each call rather than the shared fixture handle.
    db_path = db.db_path if hasattr(db, "db_path") else None
    from hermes_state import SessionDB

    monkeypatch.setattr(
        "tools.project_memory_tool._open_db",
        lambda: SessionDB(db_path=db_path) if db_path else db,
    )
    yield


def _grouped_session(db, sid="sess-1"):
    group = db.create_chat_group("G", now=time.time())
    db.assign_conversation(group["id"], sid, now=time.time())
    return group["id"]


# --- schema ---------------------------------------------------------------


def test_schema_distinguishes_from_global_memory():
    desc = PROJECT_MEMORY_SCHEMA["description"]
    assert "CURRENT PROJECT" in desc
    assert "different from the 'memory' tool" in desc
    assert PROJECT_MEMORY_SCHEMA["name"] == "project_memory"


# --- add ------------------------------------------------------------------


def test_add_saves_agent_sourced_entry(db):
    _grouped_session(db)

    out = json.loads(project_memory_tool("add", "Deploys go to Netlify.", None, "sess-1"))

    assert out["ok"] is True
    assert out["saved"] == "Deploys go to Netlify."
    entries = db.list_memory_entries(db.group_id_for_session("sess-1"))
    assert entries[0]["source"] == "agent"


def test_add_requires_content(db):
    _grouped_session(db)

    out = json.loads(project_memory_tool("add", "   ", None, "sess-1"))

    assert "error" in out


def test_add_rejects_oversize_content(db):
    _grouped_session(db)

    out = json.loads(project_memory_tool("add", "x" * (MEMORY_ENTRY_MAX + 1), None, "sess-1"))

    assert "error" in out


# --- list -----------------------------------------------------------------


def test_list_returns_entries(db):
    _grouped_session(db)
    project_memory_tool("add", "first", None, "sess-1")
    project_memory_tool("add", "second", None, "sess-1")

    out = json.loads(project_memory_tool("list", None, None, "sess-1"))

    assert out["ok"] is True
    assert [e["content"] for e in out["entries"]] == ["first", "second"]


# --- remove ---------------------------------------------------------------


def test_remove_deletes_matching_entry(db):
    _grouped_session(db)
    project_memory_tool("add", "Client wants metric units.", None, "sess-1")

    out = json.loads(project_memory_tool("remove", None, "metric", "sess-1"))

    assert out["ok"] is True
    assert db.list_memory_entries(db.group_id_for_session("sess-1")) == []


def test_remove_ambiguous_match_is_rejected(db):
    _grouped_session(db)
    project_memory_tool("add", "note alpha", None, "sess-1")
    project_memory_tool("add", "note beta", None, "sess-1")

    out = json.loads(project_memory_tool("remove", None, "note", "sess-1"))

    assert out["ok"] is False
    assert "more specific" in out["message"]


def test_remove_no_match_reports_cleanly(db):
    _grouped_session(db)

    out = json.loads(project_memory_tool("remove", None, "ghost", "sess-1"))

    assert out["ok"] is False


# --- guard rails ----------------------------------------------------------


def test_ungrouped_session_is_noop_not_error(db):
    out = json.loads(project_memory_tool("add", "x", None, "loose-sess"))

    assert out["ok"] is False
    assert "not in a project" in out["message"]


def test_unknown_action_is_error(db):
    out = json.loads(project_memory_tool("frobnicate", None, None, "sess-1"))

    assert "error" in out


def test_missing_session_is_error(db):
    out = json.loads(project_memory_tool("list", None, None, ""))

    assert "error" in out
