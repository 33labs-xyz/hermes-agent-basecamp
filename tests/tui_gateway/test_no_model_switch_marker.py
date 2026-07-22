"""Guard: a live /model switch must not inject a visible system marker into
the user-facing chat transcript.

The old ``_append_model_switch_marker`` helper appended a
``[System: The active model for this chat has changed ...]`` line to session
history. That text leaked into the transcript the user reads. Runtime
model/provider metadata is already carried by the live session system prompt
(``_persist_live_session_system_prompt``), so the marker was redundant and was
removed. This test fails if either the helper or the leak string comes back.
"""

from pathlib import Path

import tui_gateway.server as server

SERVER_SOURCE = Path(server.__file__).read_text(encoding="utf-8")


def test_marker_helper_is_gone():
    assert not hasattr(server, "_append_model_switch_marker"), (
        "_append_model_switch_marker was removed to stop the model-switch "
        "system marker leaking into the chat transcript; do not reintroduce it."
    )


def test_leak_string_absent_from_source():
    assert "active model for this chat has changed" not in SERVER_SOURCE, (
        "the model-switch marker leak string reappeared in tui_gateway/server.py"
    )
