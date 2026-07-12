#!/bin/bash
# tests/agent/fixtures/fake_claude_noisy_stderr.sh - emits a large volume of
# stderr (>= 262144 bytes / 256KB, comfortably over the OS pipe buffer) BEFORE
# finishing a normal successful stream-json turn on stdout. Reproduces the
# real CLI's --verbose behavior of chatty stderr logging alongside stdout
# output. If the parent process does not drain stderr concurrently with
# reading stdout, this script's stderr write blocks forever once the pipe
# buffer fills, the remaining stdout lines below are never emitted, and the
# turn deadlocks until an external timeout kills the process group.
echo '{"type":"system","subtype":"init","session_id":"33333333-3333-3333-3333-333333333333","tools":[],"mcp_servers":[]}'
head -c 262144 /dev/zero | tr '\0' 'e' 1>&2
echo "" 1>&2
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}}'
echo '{"type":"result","subtype":"success","result":"Hello world","session_id":"33333333-3333-3333-3333-333333333333","usage":{"input_tokens":10,"output_tokens":2}}'
