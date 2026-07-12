#!/bin/bash
# tests/agent/fixtures/fake_claude_slow.sh - emits the normal init/system
# stream-json line, then hangs, modeling a long-running turn so
# interrupt_turn() can be exercised against a genuinely in-flight
# subprocess instead of racing fixture start-up.
echo '{"type":"system","subtype":"init","session_id":"22222222-2222-2222-2222-222222222222","tools":[],"mcp_servers":[]}'
sleep 30
