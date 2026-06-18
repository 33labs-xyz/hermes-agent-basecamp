"""FastAPI routes for the dashboard conversation-library groups.

Thin handlers over ``SessionDB`` chat-group methods. They inherit the
dashboard's ``/api/`` auth gate (these paths are deliberately NOT listed in
``PUBLIC_API_PATHS``). No secrets are involved. Errors return structured
``{error_code, message}`` envelopes; the generic-exception guard prevents
traceback leakage.
"""

from __future__ import annotations

import time
from typing import Callable, Optional

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

_NAME_MAX = 100
_DESCRIPTION_MAX = 500
_INSTRUCTIONS_MAX = 16000
_FILE_NAME_MAX = 200
_FILE_CONTENT_MAX = 200_000
_MEMORY_CONTENT_MAX = 4_000


class CreateGroupBody(BaseModel):
    name: str
    description: Optional[str] = None
    instructions: Optional[str] = None


class CreateKnowledgeFileBody(BaseModel):
    name: str
    content: str
    content_type: Optional[str] = None


class CreateMemoryEntryBody(BaseModel):
    content: str


class PatchGroupBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None
    position: Optional[int] = None


def _validation_err(message: str) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error_code": "validation", "message": message})


def _not_found() -> JSONResponse:
    return JSONResponse(status_code=404, content={"error_code": "not_found", "message": "group not found"})


def _internal_err() -> JSONResponse:
    return JSONResponse(status_code=500, content={"error_code": "internal", "message": "internal error"})


def _clean_name(raw: object) -> Optional[str]:
    if not isinstance(raw, str):
        return None
    trimmed = raw.strip()
    if not trimmed or len(trimmed) > _NAME_MAX:
        return None
    return trimmed


def _clean_text(raw: object, limit: int) -> Optional[str]:
    """Normalise an optional free-text field. Returns the trimmed string (which
    may be empty, to allow clearing the field), or None if it is not a string
    or exceeds ``limit`` characters.
    """
    if not isinstance(raw, str):
        return None
    trimmed = raw.strip()
    if len(trimmed) > limit:
        return None
    return trimmed


def _default_db_factory():
    # Production path: open this process's own state.db, matching how the
    # session endpoints open it.
    from hermes_cli.web_server import _open_session_db_for_profile

    return _open_session_db_for_profile(None)


def _live_session_ids(db, session_ids: list[str]) -> list[str]:
    """Filter out member ids with no matching live session row."""
    kept = []
    for sid in session_ids:
        if db.resolve_session_id(sid):
            kept.append(sid)
    return kept


def register_chat_group_routes(app: FastAPI, db_factory: Optional[Callable] = None) -> None:
    factory = db_factory or _default_db_factory

    @app.get("/api/chat/groups", response_model=None)
    async def list_groups():
        db = factory()
        try:
            groups = db.list_chat_groups()
            for g in groups:
                g["session_ids"] = _live_session_ids(db, g.get("session_ids", []))
            return {"groups": groups}
        except Exception:
            return _internal_err()
        finally:
            db.close()

    @app.post("/api/chat/groups", response_model=None)
    async def create_group(body: CreateGroupBody):
        name = _clean_name(body.name)
        if name is None:
            return _validation_err("name required, 1-100 chars")
        description = ""
        if body.description is not None:
            description = _clean_text(body.description, _DESCRIPTION_MAX)
            if description is None:
                return _validation_err(f"description too long (max {_DESCRIPTION_MAX} chars)")
        instructions = ""
        if body.instructions is not None:
            instructions = _clean_text(body.instructions, _INSTRUCTIONS_MAX)
            if instructions is None:
                return _validation_err(f"instructions too long (max {_INSTRUCTIONS_MAX} chars)")
        db = factory()
        try:
            return db.create_chat_group(
                name,
                now=time.time(),
                description=description,
                instructions=instructions,
            )
        except Exception:
            return _internal_err()
        finally:
            db.close()

    @app.patch("/api/chat/groups/{group_id}", response_model=None)
    async def patch_group(group_id: str, body: PatchGroupBody):
        db = factory()
        try:
            now = time.time()
            updated = None
            if (
                body.name is None
                and body.description is None
                and body.instructions is None
                and body.position is None
            ):
                return _validation_err("name, description, instructions or position required")

            fields: dict[str, str] = {}
            if body.name is not None:
                name = _clean_name(body.name)
                if name is None:
                    return _validation_err("name required, 1-100 chars")
                fields["name"] = name
            if body.description is not None:
                description = _clean_text(body.description, _DESCRIPTION_MAX)
                if description is None:
                    return _validation_err(f"description too long (max {_DESCRIPTION_MAX} chars)")
                fields["description"] = description
            if body.instructions is not None:
                instructions = _clean_text(body.instructions, _INSTRUCTIONS_MAX)
                if instructions is None:
                    return _validation_err(f"instructions too long (max {_INSTRUCTIONS_MAX} chars)")
                fields["instructions"] = instructions

            if fields:
                updated = db.update_chat_group(group_id, now=now, **fields)
                if updated is None:
                    return _not_found()
            if body.position is not None:
                if not db.set_group_position(group_id, int(body.position), now=now):
                    return _not_found()
            if updated is None:
                # position-only update: re-read for the response
                for g in db.list_chat_groups():
                    if g["id"] == group_id:
                        updated = g
                        break
                if updated is None:
                    return _not_found()
            return updated
        except Exception:
            return _internal_err()
        finally:
            db.close()

    @app.delete("/api/chat/groups/{group_id}", response_model=None)
    async def delete_group(group_id: str):
        db = factory()
        try:
            if not db.delete_chat_group(group_id):
                return _not_found()
            return {"ok": True}
        except Exception:
            return _internal_err()
        finally:
            db.close()

    @app.put("/api/chat/groups/{group_id}/members/{session_id}", response_model=None)
    async def add_member(group_id: str, session_id: str):
        db = factory()
        try:
            groups = {g["id"] for g in db.list_chat_groups()}
            if group_id not in groups:
                return _not_found()
            db.assign_conversation(group_id, session_id, now=time.time())
            return {"ok": True}
        except Exception:
            return _internal_err()
        finally:
            db.close()

    @app.delete("/api/chat/groups/{group_id}/members/{session_id}", response_model=None)
    async def remove_member(group_id: str, session_id: str):
        db = factory()
        try:
            db.unassign_conversation(session_id)
            return {"ok": True}
        except Exception:
            return _internal_err()
        finally:
            db.close()

    @app.get("/api/chat/groups/{group_id}/files", response_model=None)
    async def list_files(group_id: str):
        db = factory()
        try:
            return {"files": db.list_knowledge_files(group_id)}
        except Exception:
            return _internal_err()
        finally:
            db.close()

    @app.post("/api/chat/groups/{group_id}/files", response_model=None)
    async def add_file(group_id: str, body: CreateKnowledgeFileBody):
        name = body.name.strip() if isinstance(body.name, str) else ""
        if not name or len(name) > _FILE_NAME_MAX:
            return _validation_err(f"name required, 1-{_FILE_NAME_MAX} chars")
        if not isinstance(body.content, str) or len(body.content) > _FILE_CONTENT_MAX:
            return _validation_err(f"content too large (max {_FILE_CONTENT_MAX} chars)")
        content_type = "text/markdown"
        if body.content_type is not None:
            ct = _clean_text(body.content_type, 100)
            if ct:
                content_type = ct
        db = factory()
        try:
            groups = {g["id"] for g in db.list_chat_groups()}
            if group_id not in groups:
                return _not_found()
            return db.add_knowledge_file(
                group_id, name, body.content, now=time.time(), content_type=content_type
            )
        except Exception:
            return _internal_err()
        finally:
            db.close()

    @app.delete("/api/chat/groups/{group_id}/files/{file_id}", response_model=None)
    async def delete_file(group_id: str, file_id: str):
        db = factory()
        try:
            if not db.delete_knowledge_file(group_id, file_id):
                return JSONResponse(
                    status_code=404,
                    content={"error_code": "not_found", "message": "file not found"},
                )
            return {"ok": True}
        except Exception:
            return _internal_err()
        finally:
            db.close()

    @app.get("/api/chat/groups/{group_id}/memory", response_model=None)
    async def list_memory(group_id: str):
        db = factory()
        try:
            return {"entries": db.list_memory_entries(group_id)}
        except Exception:
            return _internal_err()
        finally:
            db.close()

    @app.post("/api/chat/groups/{group_id}/memory", response_model=None)
    async def add_memory(group_id: str, body: CreateMemoryEntryBody):
        content = body.content.strip() if isinstance(body.content, str) else ""
        if not content:
            return _validation_err("content required")
        if len(content) > _MEMORY_CONTENT_MAX:
            return _validation_err(f"content too long (max {_MEMORY_CONTENT_MAX} chars)")
        db = factory()
        try:
            groups = {g["id"] for g in db.list_chat_groups()}
            if group_id not in groups:
                return _not_found()
            # UI-created entries are always user-sourced; the agent writes its
            # own via the project_memory tool, never this route.
            return db.add_memory_entry(group_id, content, now=time.time(), source="user")
        except Exception:
            return _internal_err()
        finally:
            db.close()

    @app.delete("/api/chat/groups/{group_id}/memory/{entry_id}", response_model=None)
    async def delete_memory(group_id: str, entry_id: str):
        db = factory()
        try:
            if not db.delete_memory_entry(group_id, entry_id):
                return JSONResponse(
                    status_code=404,
                    content={"error_code": "not_found", "message": "memory entry not found"},
                )
            return {"ok": True}
        except Exception:
            return _internal_err()
        finally:
            db.close()
