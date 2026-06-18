"""SessionDB chat-group (Projects) store-layer tests.

Covers the create / list / update / membership / instruction-injection /
delete lifecycle that backs the desktop Projects feature. Mirrors the
dashboard conversation-library groups: each group carries optional
``instructions`` that steer every chat assigned to it.
"""

from __future__ import annotations

import time

import pytest


def _make_db(tmp_path):
    from hermes_state import SessionDB

    return SessionDB(db_path=tmp_path / "groups_state.db")


@pytest.fixture
def db(tmp_path):
    return _make_db(tmp_path)


def test_create_returns_record_with_blank_members(db):
    now = time.time()

    group = db.create_chat_group(
        "Patent work", now=now, description="FieldSpark", instructions="Cite the claim number."
    )

    assert group["name"] == "Patent work"
    assert group["description"] == "FieldSpark"
    assert group["instructions"] == "Cite the claim number."
    assert group["session_ids"] == []
    assert group["position"] == 0


def test_create_defaults_blank_description_and_instructions(db):
    group = db.create_chat_group("Bare", now=time.time())

    assert group["description"] == ""
    assert group["instructions"] == ""


def test_list_orders_by_position_then_created(db):
    now = time.time()
    first = db.create_chat_group("First", now=now)
    second = db.create_chat_group("Second", now=now + 1)

    listed = db.list_chat_groups()

    assert [g["id"] for g in listed] == [first["id"], second["id"]]
    assert listed[1]["position"] == 1


def test_assign_conversation_appears_in_member_list(db):
    now = time.time()
    group = db.create_chat_group("Group", now=now)

    assert db.assign_conversation(group["id"], "sess-1", now=now) is True

    listed = db.list_chat_groups()
    assert listed[0]["session_ids"] == ["sess-1"]


def test_assign_is_single_group_per_conversation(db):
    now = time.time()
    a = db.create_chat_group("A", now=now)
    b = db.create_chat_group("B", now=now)

    db.assign_conversation(a["id"], "sess-1", now=now)
    db.assign_conversation(b["id"], "sess-1", now=now)

    by_id = {g["id"]: g for g in db.list_chat_groups()}
    assert by_id[a["id"]]["session_ids"] == []
    assert by_id[b["id"]]["session_ids"] == ["sess-1"]


def test_instructions_for_session_returns_group_instructions(db):
    now = time.time()
    group = db.create_chat_group("G", now=now, instructions="Always be terse.")
    db.assign_conversation(group["id"], "sess-1", now=now)

    assert db.instructions_for_session("sess-1") == "Always be terse."


def test_instructions_for_session_blank_when_ungrouped(db):
    assert db.instructions_for_session("nope") == ""


def test_instructions_for_session_blank_after_unassign(db):
    now = time.time()
    group = db.create_chat_group("G", now=now, instructions="Steer.")
    db.assign_conversation(group["id"], "sess-1", now=now)

    assert db.unassign_conversation("sess-1") is True

    assert db.instructions_for_session("sess-1") == ""


def test_unassign_returns_false_when_no_membership(db):
    assert db.unassign_conversation("ghost") is False


def test_update_changes_only_supplied_fields(db):
    now = time.time()
    group = db.create_chat_group("Old", now=now, description="d", instructions="i")

    updated = db.update_chat_group(group["id"], now=now, name="New")

    assert updated["name"] == "New"
    assert updated["description"] == "d"
    assert updated["instructions"] == "i"


def test_update_unknown_group_returns_none(db):
    assert db.update_chat_group("nope", now=time.time(), name="x") is None


def test_rename_wraps_update(db):
    now = time.time()
    group = db.create_chat_group("Before", now=now)

    renamed = db.rename_chat_group(group["id"], "After", now=now)

    assert renamed["name"] == "After"


def test_set_group_position_reorders(db):
    now = time.time()
    a = db.create_chat_group("A", now=now)
    b = db.create_chat_group("B", now=now + 1)

    assert db.set_group_position(b["id"], 0, now=now) is True
    assert db.set_group_position(a["id"], 1, now=now) is True

    assert [g["id"] for g in db.list_chat_groups()] == [b["id"], a["id"]]


def test_set_group_position_unknown_returns_false(db):
    assert db.set_group_position("nope", 0, now=time.time()) is False


def test_delete_removes_group_and_membership(db):
    now = time.time()
    group = db.create_chat_group("G", now=now)
    db.assign_conversation(group["id"], "sess-1", now=now)

    assert db.delete_chat_group(group["id"]) is True

    assert db.list_chat_groups() == []
    # The conversation falls back to ungrouped, not orphaned to the dead group.
    assert db.instructions_for_session("sess-1") == ""


def test_delete_unknown_group_returns_false(db):
    assert db.delete_chat_group("nope") is False


# --- Knowledge files ------------------------------------------------------


def test_add_knowledge_file_returns_metadata_record(db):
    now = time.time()
    group = db.create_chat_group("G", now=now)

    rec = db.add_knowledge_file(
        group["id"], "spec.md", "# Spec\nBody.", now=now, content_type="text/markdown"
    )

    assert rec["group_id"] == group["id"]
    assert rec["name"] == "spec.md"
    assert rec["content_type"] == "text/markdown"
    assert rec["size"] == len("# Spec\nBody.")
    assert "id" in rec
    # Metadata record does not echo the (potentially large) content back.
    assert "content" not in rec


def test_list_knowledge_files_returns_metadata_only(db):
    now = time.time()
    group = db.create_chat_group("G", now=now)
    db.add_knowledge_file(group["id"], "a.md", "alpha", now=now)
    db.add_knowledge_file(group["id"], "b.md", "beta", now=now + 1)

    files = db.list_knowledge_files(group["id"])

    assert [f["name"] for f in files] == ["a.md", "b.md"]
    assert all("content" not in f for f in files)


def test_list_knowledge_files_empty_for_unknown_group(db):
    assert db.list_knowledge_files("nope") == []


def test_delete_knowledge_file_removes_it(db):
    now = time.time()
    group = db.create_chat_group("G", now=now)
    rec = db.add_knowledge_file(group["id"], "a.md", "alpha", now=now)

    assert db.delete_knowledge_file(group["id"], rec["id"]) is True
    assert db.list_knowledge_files(group["id"]) == []


def test_delete_knowledge_file_unknown_returns_false(db):
    now = time.time()
    group = db.create_chat_group("G", now=now)
    assert db.delete_knowledge_file(group["id"], "ghost") is False


def test_delete_group_cascades_knowledge_files(db):
    now = time.time()
    group = db.create_chat_group("G", now=now)
    db.add_knowledge_file(group["id"], "a.md", "alpha", now=now)

    assert db.delete_chat_group(group["id"]) is True
    assert db.list_knowledge_files(group["id"]) == []


def test_build_project_context_blank_when_ungrouped(db):
    assert db.build_project_context("nope") == ""


def test_build_project_context_includes_instructions_only(db):
    now = time.time()
    group = db.create_chat_group("G", now=now, instructions="Be terse.")
    db.assign_conversation(group["id"], "sess-1", now=now)

    ctx = db.build_project_context("sess-1")

    assert "Be terse." in ctx


def test_build_project_context_includes_knowledge_files(db):
    now = time.time()
    group = db.create_chat_group("G", now=now, instructions="Be terse.")
    db.assign_conversation(group["id"], "sess-1", now=now)
    db.add_knowledge_file(group["id"], "facts.md", "Sky is blue.", now=now)

    ctx = db.build_project_context("sess-1")

    assert "Be terse." in ctx
    assert "facts.md" in ctx
    assert "Sky is blue." in ctx


def test_build_project_context_caps_total_size(db):
    now = time.time()
    group = db.create_chat_group("G", now=now)
    db.assign_conversation(group["id"], "sess-1", now=now)
    # Two oversized files; total injected context must stay bounded.
    db.add_knowledge_file(group["id"], "big1.md", "x" * 40_000, now=now)
    db.add_knowledge_file(group["id"], "big2.md", "y" * 40_000, now=now + 1)

    ctx = db.build_project_context("sess-1")

    assert len(ctx) <= 33_000
