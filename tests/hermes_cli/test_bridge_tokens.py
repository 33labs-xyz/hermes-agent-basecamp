from hermes_cli.bridge_tokens import (
    register_bridge_token,
    revoke_bridge_token,
    verify_bridge_token,
)


def test_registered_token_verifies_true():
    register_bridge_token("sess-a", "tok-a")
    try:
        assert verify_bridge_token("sess-a", "tok-a") is True
    finally:
        revoke_bridge_token("sess-a")


def test_wrong_token_verifies_false():
    register_bridge_token("sess-b", "tok-b")
    try:
        assert verify_bridge_token("sess-b", "nope") is False
    finally:
        revoke_bridge_token("sess-b")


def test_unregistered_session_verifies_false():
    assert verify_bridge_token("sess-unknown", "whatever") is False


def test_revoke_removes_token():
    register_bridge_token("sess-c", "tok-c")
    revoke_bridge_token("sess-c")
    assert verify_bridge_token("sess-c", "tok-c") is False


def test_empty_args_never_authorize():
    assert verify_bridge_token("", "") is False
    register_bridge_token("", "x")          # ignored, no crash
    register_bridge_token("sess-d", "")     # ignored, no crash
    assert verify_bridge_token("sess-d", "") is False
