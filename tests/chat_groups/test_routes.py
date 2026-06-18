"""FastAPI route tests for the Projects (chat-group) endpoints.

Exercises the handlers in ``hermes_cli.chat_groups.routes`` against a
temp-file ``SessionDB`` via an injected ``db_factory`` (a fresh connection
per request, matching production where each call opens the process state.db).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path):
    from hermes_cli.chat_groups.routes import register_chat_group_routes
    from hermes_state import SessionDB

    db_path = tmp_path / "routes_state.db"
    app = FastAPI()
    # Fresh connection per request; the route handlers close it in `finally`.
    register_chat_group_routes(app, db_factory=lambda profile=None: SessionDB(db_path=db_path))
    return TestClient(app)


def _create(client, **body):
    body.setdefault("name", "Group")
    return client.post("/api/chat/groups", json=body)


def test_create_returns_record(client):
    resp = _create(client, name="Patent", description="FS", instructions="Cite claim #.")

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["name"] == "Patent"
    assert payload["description"] == "FS"
    assert payload["instructions"] == "Cite claim #."
    assert payload["session_ids"] == []


def test_create_blank_name_is_400(client):
    assert _create(client, name="   ").status_code == 400


def test_create_name_too_long_is_400(client):
    assert _create(client, name="x" * 101).status_code == 400


def test_create_description_too_long_is_400(client):
    assert _create(client, name="ok", description="d" * 501).status_code == 400


def test_create_instructions_too_long_is_400(client):
    assert _create(client, name="ok", instructions="i" * 16001).status_code == 400


def test_list_returns_created_groups(client):
    _create(client, name="One")
    _create(client, name="Two")

    resp = client.get("/api/chat/groups")

    assert resp.status_code == 200
    names = [g["name"] for g in resp.json()["groups"]]
    assert names == ["One", "Two"]


def test_list_filters_orphan_member_sessions(client):
    gid = _create(client, name="G").json()["id"]
    # sess-x has no live session row, so it is filtered from the member list.
    client.put(f"/api/chat/groups/{gid}/members/sess-x")

    groups = client.get("/api/chat/groups").json()["groups"]

    assert groups[0]["session_ids"] == []


def test_patch_updates_name(client):
    gid = _create(client, name="Before").json()["id"]

    resp = client.patch(f"/api/chat/groups/{gid}", json={"name": "After"})

    assert resp.status_code == 200
    assert resp.json()["name"] == "After"


def test_patch_instructions_only_keeps_name(client):
    gid = _create(client, name="Keep", instructions="old").json()["id"]

    resp = client.patch(f"/api/chat/groups/{gid}", json={"instructions": "new"})

    assert resp.status_code == 200
    assert resp.json()["name"] == "Keep"
    assert resp.json()["instructions"] == "new"


def test_patch_empty_body_is_400(client):
    gid = _create(client, name="G").json()["id"]

    assert client.patch(f"/api/chat/groups/{gid}", json={}).status_code == 400


def test_patch_unknown_group_is_404(client):
    assert client.patch("/api/chat/groups/nope", json={"name": "x"}).status_code == 404


def test_add_member_unknown_group_is_404(client):
    assert client.put("/api/chat/groups/nope/members/sess-1").status_code == 404


def test_add_and_remove_member(client):
    gid = _create(client, name="G").json()["id"]

    assert client.put(f"/api/chat/groups/{gid}/members/sess-1").status_code == 200
    assert client.delete(f"/api/chat/groups/{gid}/members/sess-1").status_code == 200


def test_delete_group(client):
    gid = _create(client, name="G").json()["id"]

    assert client.delete(f"/api/chat/groups/{gid}").status_code == 200
    assert client.get("/api/chat/groups").json()["groups"] == []


def test_delete_unknown_group_is_404(client):
    assert client.delete("/api/chat/groups/nope").status_code == 404


# --- Knowledge files ------------------------------------------------------


def _add_file(client, gid, **body):
    body.setdefault("name", "doc.md")
    body.setdefault("content", "Body.")
    return client.post(f"/api/chat/groups/{gid}/files", json=body)


def test_add_file_returns_metadata(client):
    gid = _create(client, name="G").json()["id"]

    resp = _add_file(client, gid, name="spec.md", content="# Spec")

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["name"] == "spec.md"
    assert payload["size"] == len("# Spec")
    assert "content" not in payload


def test_add_file_unknown_group_is_404(client):
    assert _add_file(client, "nope").status_code == 404


def test_add_file_blank_name_is_400(client):
    gid = _create(client, name="G").json()["id"]
    assert _add_file(client, gid, name="   ").status_code == 400


def test_add_file_content_too_large_is_400(client):
    gid = _create(client, name="G").json()["id"]
    assert _add_file(client, gid, content="x" * 200_001).status_code == 400


def test_list_files_returns_added(client):
    gid = _create(client, name="G").json()["id"]
    _add_file(client, gid, name="a.md")
    _add_file(client, gid, name="b.md")

    resp = client.get(f"/api/chat/groups/{gid}/files")

    assert resp.status_code == 200
    assert [f["name"] for f in resp.json()["files"]] == ["a.md", "b.md"]


def test_delete_file(client):
    gid = _create(client, name="G").json()["id"]
    fid = _add_file(client, gid, name="a.md").json()["id"]

    assert client.delete(f"/api/chat/groups/{gid}/files/{fid}").status_code == 200
    assert client.get(f"/api/chat/groups/{gid}/files").json()["files"] == []


def test_delete_unknown_file_is_404(client):
    gid = _create(client, name="G").json()["id"]
    assert client.delete(f"/api/chat/groups/{gid}/files/ghost").status_code == 404


# --- Project memory -------------------------------------------------------


def _add_memory(client, gid, content="User ships to Netlify."):
    return client.post(f"/api/chat/groups/{gid}/memory", json={"content": content})


def test_add_memory_returns_record(client):
    gid = _create(client, name="G").json()["id"]

    resp = _add_memory(client, gid, content="Prefers metric units.")

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["content"] == "Prefers metric units."
    assert payload["source"] == "user"
    assert "id" in payload


def test_add_memory_unknown_group_is_404(client):
    assert _add_memory(client, "nope").status_code == 404


def test_add_memory_blank_content_is_400(client):
    gid = _create(client, name="G").json()["id"]
    assert _add_memory(client, gid, content="   ").status_code == 400


def test_add_memory_content_too_large_is_400(client):
    gid = _create(client, name="G").json()["id"]
    assert _add_memory(client, gid, content="x" * 4_001).status_code == 400


def test_list_memory_returns_added(client):
    gid = _create(client, name="G").json()["id"]
    _add_memory(client, gid, content="first")
    _add_memory(client, gid, content="second")

    resp = client.get(f"/api/chat/groups/{gid}/memory")

    assert resp.status_code == 200
    assert [e["content"] for e in resp.json()["entries"]] == ["first", "second"]


def test_delete_memory_entry(client):
    gid = _create(client, name="G").json()["id"]
    eid = _add_memory(client, gid).json()["id"]

    assert client.delete(f"/api/chat/groups/{gid}/memory/{eid}").status_code == 200
    assert client.get(f"/api/chat/groups/{gid}/memory").json()["entries"] == []


def test_delete_unknown_memory_entry_is_404(client):
    gid = _create(client, name="G").json()["id"]
    assert client.delete(f"/api/chat/groups/{gid}/memory/ghost").status_code == 404
