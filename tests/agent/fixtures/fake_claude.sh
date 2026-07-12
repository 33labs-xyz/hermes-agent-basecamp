#!/bin/bash
# tests/agent/fixtures/fake_claude.sh - emits a canned stream-json turn
echo '{"type":"system","subtype":"init","session_id":"11111111-1111-1111-1111-111111111111","tools":[],"mcp_servers":[]}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}}'
echo '{"type":"result","subtype":"success","result":"Hello world","session_id":"11111111-1111-1111-1111-111111111111","usage":{"input_tokens":10,"output_tokens":2}}'
