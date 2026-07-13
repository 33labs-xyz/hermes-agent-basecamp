#!/bin/bash
# tests/agent/fixtures/fake_claude_mcp.sh - emits a stream-json turn that
# looks like the model made one MCP tool call. Reads its own --mcp-config
# file and echoes the bridge token found inside it back on the assistant
# event, as a "hermes_test_token" field alongside the real tool_use block.
# That lets the Python test assert the config file existed, on disk, with
# the expected token, DURING the turn - without racing run_claude_cli_turn's
# post-turn cleanup of that same file.
config_path=""
prev=""
for arg in "$@"; do
    if [ "$prev" = "--mcp-config" ]; then
        config_path="$arg"
    fi
    prev="$arg"
done

token=$(CONFIG_PATH="$config_path" python3 -c "
import json, os
with open(os.environ['CONFIG_PATH']) as fh:
    cfg = json.load(fh)
args = cfg['mcpServers']['basecamp']['args']
print(args[args.index('--bridge-token') + 1])
")

echo '{"type":"system","subtype":"init","session_id":"22222222-2222-2222-2222-222222222222","tools":[],"mcp_servers":["basecamp"]}'
echo "{\"type\":\"assistant\",\"hermes_test_token\":\"${token}\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"mcp__basecamp__web_search\",\"input\":{\"query\":\"test\"}}]}}"
echo '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"ok"}]}}'
echo '{"type":"result","subtype":"success","result":"Used the bridge tool.","session_id":"22222222-2222-2222-2222-222222222222","usage":{"input_tokens":5,"output_tokens":3}}'
