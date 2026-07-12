#!/bin/bash
# tests/agent/fixtures/fake_claude_auth_error.sh - emits an auth-failure turn.
# Matches real CLI 2.1.202 behavior: subtype stays "success" but is_error is
# true, the failure text arrives in "result" (never in stderr), and the
# process exits 1 (verified live against the real CLI, see task-1-report.md).
echo '{"type":"system","subtype":"init","session_id":"22222222-2222-2222-2222-222222222222","tools":[],"mcp_servers":[]}'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"Not logged in · Please run /login"}]},"error":"authentication_failed"}'
echo '{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login","session_id":"22222222-2222-2222-2222-222222222222","usage":{"input_tokens":0,"output_tokens":0}}'
exit 1
