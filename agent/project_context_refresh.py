"""Per-turn project (chat_group) context refresh.

A chat that belongs to a Project must be steered by that project's
instructions + knowledge + memory. The project context is recomputed on
*every* turn — not baked into the agent once at construction — so that:

- associating a chat with a project takes effect on the very next message,
- editing the project's instructions takes effect immediately,
- a long-lived cached agent (the desktop dashboard reuses one AIAgent per
  session for its whole lifetime) never serves a stale snapshot.

The result is appended to the system block at API-call time only. It is
never folded into the persisted base prompt (``_cached_system_prompt``) or
into ``ephemeral_system_prompt``, so the prompt-cache prefix stays stable
and nothing leaks into session persistence.
"""


def project_context_for_agent(agent) -> str:
    """Return the agent's current project context, or "" when it has none.

    Reads straight from the agent's own SessionDB + session id so the lookup
    always reflects the live membership/instructions, regardless of when the
    agent was built. Any failure resolves to "" — a missing project block
    must never break a turn.
    """
    session_db = getattr(agent, "_session_db", None)
    session_id = getattr(agent, "session_id", None)
    if session_db is None or not session_id:
        return ""
    try:
        return session_db.build_project_context(session_id) or ""
    except Exception:
        return ""


def append_project_context(effective_system: str, agent) -> str:
    """Append the agent's fresh project context to ``effective_system``.

    No-op when the chat is ungrouped (project context resolves to "").
    """
    project_context = project_context_for_agent(agent)
    if not project_context:
        return effective_system
    if effective_system:
        return (effective_system + "\n\n" + project_context).strip()
    return project_context
