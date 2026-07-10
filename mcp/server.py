"""AgentFleet MCP server — exposes the published agent fleet as MCP tools.

Any MCP client (Claude Desktop, Claude Code, etc.) can list the agents and
ask one a question via the same public API that apps/api/app/routes/public.py
serves. Run with: cd apps/api && uv run python ../../mcp/server.py
"""

import os

import httpx
from mcp.server.fastmcp import FastMCP

AGENTFLEET_API_URL = os.environ.get("AGENTFLEET_API_URL", "http://localhost:8000")
AGENTFLEET_API_KEY = os.environ.get("AGENTFLEET_API_KEY", "")

mcp = FastMCP("AgentFleet")


@mcp.tool()
async def list_agents() -> list[dict]:
    """List the agents available on this AgentFleet instance."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{AGENTFLEET_API_URL}/api/v1/agents")
    response.raise_for_status()
    return [
        {"slug": a["slug"], "name": a["name"], "description": a["description"]}
        for a in response.json()
    ]


@mcp.tool()
async def ask_agent(slug: str, message: str) -> str:
    """Ask a published AgentFleet agent a question and return its reply.

    Args:
        slug: The agent's slug (see list_agents).
        message: The message/question to send to the agent.
    """
    if not AGENTFLEET_API_KEY:
        return (
            "AGENTFLEET_API_KEY is not set. Create a key for this agent in the "
            "AgentFleet UI (Agents > API keys) and set it in this server's env."
        )
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{AGENTFLEET_API_URL}/api/v1/public/agents/{slug}/invoke",
            json={"message": message},
            headers={"Authorization": f"Bearer {AGENTFLEET_API_KEY}"},
        )
    if response.status_code != 200:
        try:
            detail = response.json().get("detail", response.text)
        except ValueError:
            detail = response.text
        return f"Error ({response.status_code}): {detail}"
    return response.json()["reply"]


if __name__ == "__main__":
    mcp.run()
