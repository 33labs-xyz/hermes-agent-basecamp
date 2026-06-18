#!/usr/bin/env python3
"""Project Memory Tool - durable per-project notes the agent can write.

This is distinct from the global ``memory`` tool (tools/memory_tool.py), which
stores profile-wide facts in MEMORY.md / USER.md. This tool writes short notes
scoped to the *project* (chat group) the current conversation belongs to. Those
notes are injected back into the agent's system prompt for every chat in the
same project via ``SessionDB.build_project_context``.

Use it for facts that matter to this project specifically -- a deploy target, a
client constraint, a naming convention -- not for global user preferences (that
is the ``memory`` tool) and not for task progress (that is session_search).

The tool resolves the active project from the session id supplied by the
dispatcher. If the conversation is not in a project, writes are a no-op with a
clear message rather than an error, so the model can fail gracefully.
"""

import time
from typing import Any, Dict, Optional

from tools.registry import registry, tool_error, tool_result

# Upper bound on a single memory entry written by the agent. Matches the REST
# route cap (hermes_cli/chat_groups/routes.py:_MEMORY_CONTENT_MAX) so UI- and
# agent-authored entries share one limit. Entries are short durable notes, not
# documents -- knowledge files exist for long content.
MEMORY_ENTRY_MAX = 4_000


def _open_db():
    # Default-profile state.db, matching how the memory tool and the dashboard
    # session endpoints open it. Imported lazily so importing this module never
    # forces a DB connection at registration time.
    from hermes_state import SessionDB

    return SessionDB()


def project_memory_tool(
    action: str,
    content: Optional[str],
    old_text: Optional[str],
    session_id: Optional[str],
) -> str:
    """Add / list / remove durable notes for the current project.

    Returns a JSON string (success envelope or error) for the model.
    """
    action = (action or "").strip().lower()
    if action not in {"add", "list", "remove"}:
        return tool_error("action must be one of: add, list, remove")

    sid = (session_id or "").strip()
    if not sid:
        return tool_error("no active session; cannot resolve a project")

    db = None
    try:
        db = _open_db()
        group_id = db.group_id_for_session(sid)
        if not group_id:
            return tool_result(
                ok=False,
                message=(
                    "This chat is not in a project, so there is no project memory "
                    "to read or write. Assign it to a project first."
                ),
            )

        if action == "list":
            entries = db.list_memory_entries(group_id)
            return tool_result(
                ok=True,
                entries=[{"content": e["content"], "source": e["source"]} for e in entries],
            )

        if action == "add":
            text = (content or "").strip()
            if not text:
                return tool_error("content required for 'add'")
            if len(text) > MEMORY_ENTRY_MAX:
                return tool_error(f"content too long (max {MEMORY_ENTRY_MAX} chars)")
            rec = db.add_memory_entry(group_id, text, now=time.time(), source="agent")
            return tool_result(ok=True, saved=rec["content"])

        # remove
        needle = (old_text or "").strip()
        if not needle:
            return tool_error("old_text required for 'remove' (a substring of the entry)")
        matches = [
            e for e in db.list_memory_entries(group_id) if needle in e["content"]
        ]
        if not matches:
            return tool_result(ok=False, message="no project memory entry matched old_text")
        if len(matches) > 1:
            return tool_result(
                ok=False,
                message=f"old_text matched {len(matches)} entries; use a more specific substring",
            )
        db.delete_memory_entry(group_id, matches[0]["id"])
        return tool_result(ok=True, removed=matches[0]["content"])
    except Exception as exc:  # noqa: BLE001 - surface a clean message to the model
        return tool_error(f"project memory failed: {exc}")
    finally:
        if db is not None:
            db.close()


def check_project_memory_requirements() -> bool:
    """No external requirements; the SQLite state.db is always present."""
    return True


PROJECT_MEMORY_SCHEMA = {
    "name": "project_memory",
    "description": (
        "Save durable notes scoped to the CURRENT PROJECT. These notes are injected "
        "into every chat in this project, so keep them compact and factual.\n\n"
        "This is different from the 'memory' tool: 'memory' stores global facts about "
        "the user across all projects; 'project_memory' stores facts about THIS project "
        "only (its deploy target, client constraints, conventions, decisions).\n\n"
        "WHEN TO SAVE (proactively):\n"
        "- A project-specific decision, constraint, or convention you should respect later\n"
        "- A stable fact about this project's stack, hosts, accounts, or data\n"
        "- Something the user tells you to remember 'for this project'\n\n"
        "Do NOT save task progress, global user preferences (use 'memory'), or long "
        "documents (add those as project knowledge files instead).\n\n"
        "If the chat is not in a project, this tool reports that and saves nothing.\n\n"
        "ACTIONS: add (new note -- needs content), list (read current notes), "
        "remove (delete -- old_text is a unique substring of the note)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["add", "list", "remove"],
                "description": "The action to perform.",
            },
            "content": {
                "type": "string",
                "description": "The note content. Required for 'add'.",
            },
            "old_text": {
                "type": "string",
                "description": "Unique substring identifying the note to remove. Required for 'remove'.",
            },
        },
        "required": ["action"],
    },
}


registry.register(
    name="project_memory",
    toolset="memory",
    schema=PROJECT_MEMORY_SCHEMA,
    handler=lambda args, **kw: project_memory_tool(
        action=args.get("action", ""),
        content=args.get("content"),
        old_text=args.get("old_text"),
        session_id=kw.get("session_id"),
    ),
    check_fn=check_project_memory_requirements,
    emoji="📌",
)
