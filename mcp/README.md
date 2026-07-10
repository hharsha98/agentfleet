# AgentFleet MCP server

Exposes the AgentFleet fleet as MCP tools: `list_agents()` and
`ask_agent(slug, message)`. Any MCP client can talk to your published agents.

## Run

```bash
cd apps/api && uv run python ../../mcp/server.py
```

## Claude Desktop / Code config

```json
{"mcpServers": {"agentfleet": {
  "command": "uv",
  "args": ["run", "--project", "/abs/path/to/apps/api", "python", "/abs/path/to/mcp/server.py"],
  "env": {"AGENTFLEET_API_URL": "http://localhost:8000", "AGENTFLEET_API_KEY": "af_your_key_here"}
}}}
```
