"""The desktop gateway must never harvest the tester's real OS admin password.

An autonomous agent running unsupervised on a tester's machine had its sudo
password callback wired to ``_block("sudo.request", ...)``, which pops an
"Administrator password" modal, captures whatever the tester types, and then
runs the privileged command with it. A rogue model turning "text my dad" into
``sudo chown -R ...`` therefore both showed the modal AND (once answered) ran
the privileged command.

The gateway callback must instead *refuse*: return an empty password without
prompting. With no password, ``_transform_sudo_command`` leaves the command
unchanged so sudo fails gracefully ("a password is required") and the
privileged command does not run. Testers who deliberately opt in via a
``SUDO_PASSWORD`` env var or NOPASSWD sudoers are unaffected -- both are
consulted before the callback in ``_transform_sudo_command``.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture()
def server():
    with patch.dict(
        "sys.modules",
        {
            "hermes_constants": MagicMock(
                get_hermes_home=MagicMock(return_value=Path("/tmp/hermes_test_sudo_refuse"))
            ),
            "hermes_cli.env_loader": MagicMock(),
            "hermes_cli.banner": MagicMock(),
            "hermes_state": MagicMock(),
        },
    ):
        import importlib

        mod = importlib.import_module("tui_gateway.server")
        yield mod
        mod._sessions.clear()
        mod._pending.clear()
        mod._answers.clear()


def test_wire_callbacks_registers_refusing_sudo_callback(server, monkeypatch):
    """After _wire_callbacks, the sudo password callback returns "" and never
    calls _block (i.e. never pops the admin-password modal)."""
    from tools import terminal_tool

    # If the sudo callback reaches _block, it would pop the desktop modal that
    # harvests the tester's real admin password. Fail loudly if it does.
    def _forbidden_block(*args, **kwargs):
        raise AssertionError(
            "sudo callback invoked _block -> admin-password modal would harvest "
            "the tester's OS password"
        )

    monkeypatch.setattr(server, "_block", _forbidden_block)

    try:
        server._wire_callbacks("sid-under-test")
        sudo_cb = terminal_tool._get_sudo_password_callback()
        assert sudo_cb is not None, "gateway must register a sudo callback (else /dev/tty hang)"
        # Refuses: returns empty password without prompting.
        assert sudo_cb() == ""
    finally:
        terminal_tool.set_sudo_password_callback(None)
