"""MCP (Model Context Protocol) toolbox: lets an agent's own list of external
MCP servers (agent.mcp_servers, set in the agent builder UI) show up as
regular OpenAI-format tools during a chat turn.

Each server is a user-supplied HTTP(S) URL, so failure is expected — an
unreachable or misconfigured server must never break the chat turn for tools
the agent *does* have. Every per-server step is wrapped and only logged.
"""

import logging
from contextlib import AsyncExitStack

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

logger = logging.getLogger(__name__)

TOOL_RESULT_MAX_CHARS = 4000


def to_openai_spec(
    server_name: str, tool_name: str, description: str, input_schema: dict | None
) -> dict:
    """Build the OpenAI tool-call schema for one MCP tool, namespaced by
    server so tool names from different servers can never collide."""
    return {
        "type": "function",
        "function": {
            "name": f"mcp_{server_name}_{tool_name}",
            "description": description or "",
            "parameters": input_schema or {"type": "object", "properties": {}},
        },
    }


def split_tool_name(prefixed: str, server_names: list[str]) -> tuple[str, str] | None:
    """Reverse to_openai_spec's naming: "mcp_{server}_{tool}" -> (server, tool).

    Server names may themselves contain "_" (e.g. "a" and "a_b" both valid),
    so ambiguous prefixes are resolved by taking the *longest* matching
    "mcp_{server}_" prefix.
    """
    candidates: list[tuple[str, str]] = []
    for name in server_names:
        prefix = f"mcp_{name}_"
        if prefixed.startswith(prefix):
            candidates.append((name, prefixed[len(prefix) :]))
    if not candidates:
        return None
    candidates.sort(key=lambda c: len(c[0]), reverse=True)
    return candidates[0]


class McpToolbox:
    """Async context manager: connects to every configured MCP server,
    collects their tools as OpenAI specs, and can dispatch a prefixed tool
    call back to the right server.
    """

    def __init__(self, servers: list[dict]) -> None:
        self._servers = servers
        self._stack = AsyncExitStack()
        self._sessions: dict[str, ClientSession] = {}
        self.specs: list[dict] = []

    async def __aenter__(self) -> "McpToolbox":
        for server in self._servers:
            name = server.get("name", "")
            url = server.get("url", "")
            # Each server gets its own stack: a connect failure must unwind
            # (and fully surface) right here, not get deferred into the
            # shared stack's final aclose() where it would be indistinguishable
            # from every other server and could crash teardown for all of them.
            local_stack = AsyncExitStack()
            try:
                read, write, _ = await local_stack.enter_async_context(
                    streamablehttp_client(url)
                )
                session = await local_stack.enter_async_context(ClientSession(read, write))
                await session.initialize()
                tools_result = await session.list_tools()
                self._sessions[name] = session
                for tool in tools_result.tools:
                    self.specs.append(
                        to_openai_spec(name, tool.name, tool.description or "", tool.inputSchema)
                    )
                # Success: hand this server's resources to the shared stack so
                # __aexit__ closes them alongside every other live server.
                self._stack.push_async_callback(local_stack.aclose)
            except BaseException:
                # BaseException, not Exception: an unreachable/refused server
                # surfaces as a raw asyncio.CancelledError from the transport's
                # internal task group (anyio cancels the in-flight read when
                # the connect fails), which `except Exception` would miss and
                # let crash the whole chat turn — exactly what this must not
                # do for a per-agent, user-supplied server URL.
                # Expected condition (user-supplied URL may be wrong/down):
                # one quiet line, full tracebacks only at debug level.
                logger.warning("MCP server %r (%s) unavailable; skipping", name, url)
                logger.debug("MCP connect failure detail for %r", name, exc_info=True)
                self._sessions.pop(name, None)
                try:
                    await local_stack.aclose()
                except BaseException:
                    logger.debug(
                        "cleanup after failed MCP server %r also failed", name, exc_info=True
                    )
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self._stack.aclose()

    async def call(self, prefixed_name: str, arguments: dict) -> str:
        try:
            resolved = split_tool_name(prefixed_name, list(self._sessions.keys()))
            if resolved is None:
                return f"Tool error: unknown MCP tool {prefixed_name}"
            server_name, tool_name = resolved
            session = self._sessions[server_name]
            result = await session.call_tool(tool_name, arguments)
            text = "\n".join(
                part.text for part in result.content if getattr(part, "type", None) == "text"
            )
            return text[:TOOL_RESULT_MAX_CHARS]
        except Exception as exc:
            return f"Tool error: {type(exc).__name__}"
