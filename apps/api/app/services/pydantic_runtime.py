"""Pydantic AI-based agent runtime — a second SDK runtime (Phase 10 M; see
ARCHITECTURE.md ADR-001, "one roster agent may be re-implemented on a second
SDK later to show breadth"). This is that agent: any Agent row whose
`runtime` column is "pydantic-ai" runs its chat turns through this module
instead of graph_runtime.py's LangGraph StateGraph.

Reuses the same building blocks as graph_runtime.py: budget checks
(services/budget.py), the builtin tool functions (app.tools, wrapped as
Pydantic AI tools rather than rewritten), and cost metering (app.costs).
The SSE wire contract emitted is byte-for-byte identical to graph_runtime's
/ chat.py's: `data: {json}\n\n` frames of type token / tool_call /
tool_result / done / error — a client cannot tell which runtime produced
the stream.

Scope is intentionally narrow: two wrapped tools (web_search,
search_documents), no MCP dispatch, no guardrail scanning, no
recursion-limit salvage path. This runtime exists to demonstrate framework
breadth, not to reach feature parity with the LangGraph runtime.
"""

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncGenerator

from pydantic_ai import Agent as PydanticAgent
from pydantic_ai.exceptions import AgentRunError
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart, UserPromptPart
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from sqlalchemy import select

from app.config import get_settings
from app.costs import cost_usd
from app.db import SessionLocal
from app.models import Agent, Conversation, Message
from app.services.budget import check_budget
from app.services.chat import MAX_HISTORY_MESSAGES
from app.tools import TOOLS, run_tool

logger = logging.getLogger(__name__)

# Which builtin tools this runtime knows how to wrap. A small, explicit
# subset (not all of app.tools.TOOLS) — this runtime's job is to show a
# second SDK works, not to carry every tool graph_runtime supports.
WRAPPABLE_TOOLS = ("web_search", "search_documents")


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _make_tool_wrapper(name: str, user_id: uuid.UUID | None = None):
    """Thin async wrapper around an app.tools function: same (query,
    max_results) signature both wrappable tools share, delegating the real
    work to run_tool() so behavior (incl. its try/except-to-string
    fallback) stays exactly what graph_runtime and chat.py already use.
    `name` and `user_id` are captured by closure, not default args, so
    neither leaks into the JSON schema Pydantic AI builds from the function
    signature. `user_id` (the conversation's owner) is forwarded to every
    call regardless of tool name — run_tool itself only actually applies it
    to search_documents (see run_tool's docstring), so this stays a no-op
    for web_search.
    """

    async def _tool(query: str, max_results: int = 5) -> str:
        return await run_tool(
            name, {"query": query, "max_results": max_results}, user_id=user_id
        )

    _tool.__name__ = name
    return _tool


def build_pydantic_agent(
    agent_row: Agent, base_url: str, api_key: str, user_id: uuid.UUID | None = None
) -> PydanticAgent:
    """Assemble a Pydantic AI Agent configured from the DB row: same model
    and system_prompt an agent would use under graph_runtime, plus whichever
    of WRAPPABLE_TOOLS the row opted into via its `tools` column.

    `user_id` is the calling conversation's owner (see stream_chat_pydantic
    below), threaded into each wrapped tool so search_documents can apply
    its per-user ownership filter (app/tools.py) — the fix for the
    cross-tenant RAG leak. Optional/defaulted so this stays a drop-in
    signature for anything that doesn't need it.
    """
    model = OpenAIChatModel(
        agent_row.model,
        provider=OpenAIProvider(base_url=base_url, api_key=api_key or "x"),
    )
    pai_agent = PydanticAgent(model, system_prompt=agent_row.system_prompt)
    for name in WRAPPABLE_TOOLS:
        if name in (agent_row.tools or []):
            description = TOOLS[name]["spec"]["function"]["description"]
            pai_agent.tool_plain(name=name, description=description)(
                _make_tool_wrapper(name, user_id)
            )
    return pai_agent


def _history_to_pydantic(history: list[Message]) -> list[ModelMessage]:
    """Message rows -> Pydantic AI's own message history shape (ModelRequest
    / ModelResponse), the same replay-full-history approach graph_runtime
    and chat.py use, just in this SDK's native types instead of LangChain's."""
    messages: list[ModelMessage] = []
    for m in history:
        if m.role == "user" and m.content:
            messages.append(ModelRequest(parts=[UserPromptPart(content=m.content)]))
        elif m.role == "assistant" and m.content:
            messages.append(ModelResponse(parts=[TextPart(content=m.content)]))
    return messages


async def stream_chat_pydantic(conversation_id: uuid.UUID, user_text: str) -> AsyncGenerator[str, None]:
    async with SessionLocal() as session:
        try:
            conversation = await session.get(Conversation, conversation_id)
            if conversation is None:
                yield _sse({"type": "error", "message": "Conversation not found"})
                return
            agent = await session.get(Agent, conversation.agent_id)

            violation = await check_budget(session, agent.id)
            if violation:
                yield _sse({"type": "error", "message": violation})
                return

            recent = (
                (
                    await session.execute(
                        select(Message)
                        .where(Message.conversation_id == conversation.id)
                        .order_by(Message.created_at.desc())
                        .limit(MAX_HISTORY_MESSAGES)
                    )
                )
                .scalars()
                .all()
            )
            message_history = _history_to_pydantic(list(reversed(recent)))

            session.add(Message(conversation_id=conversation.id, role="user", content=user_text))
            await session.commit()
        except Exception:
            logger.exception(
                "pydantic-ai chat setup failed for conversation %s", conversation_id
            )
            yield _sse({"type": "error", "message": "Could not start the reply. Please try again."})
            return

        settings = get_settings()
        started = time.monotonic()
        parts: list[str] = []
        tokens_in = tokens_out = 0
        errored = False
        interrupted: BaseException | None = None

        try:
            pai_agent = build_pydantic_agent(
                agent, settings.free_llm_base_url, settings.free_llm_key, conversation.user_id
            )
            # Streaming path: the installed pydantic-ai-slim (2.11.0)
            # supports run_stream + stream_text(delta=True) cleanly against
            # our OpenAI-compatible proxy (verified live), so we stream real
            # deltas rather than emitting one final-text token event.
            async with pai_agent.run_stream(
                user_text,
                message_history=message_history,
                model_settings={"temperature": agent.temperature},
            ) as result:
                async for chunk in result.stream_text(delta=True):
                    if chunk:
                        parts.append(chunk)
                        yield _sse({"type": "token", "content": chunk})
                usage = result.usage
                tokens_in += usage.input_tokens or 0
                tokens_out += usage.output_tokens or 0
        except AgentRunError as exc:
            # Base class for every Pydantic AI run-time failure (auth,
            # rate limit, malformed response, timeout, ...) — sanitized
            # message only, like graph_runtime/chat.py's provider-error path.
            errored = True
            logger.warning(
                "pydantic-ai provider error for conversation %s", conversation_id, exc_info=True
            )
            yield _sse(
                {
                    "type": "error",
                    "message": f"The model provider returned an error ({type(exc).__name__}). "
                    "Please try again.",
                }
            )
        except (asyncio.CancelledError, GeneratorExit) as exc:
            # Client disconnected mid-stream — persist the partial turn
            # below, then re-raise so the ASGI layer sees the cancellation.
            interrupted = exc
        except Exception as exc:
            errored = True
            logger.exception("pydantic-ai run failed for conversation %s", conversation_id)
            yield _sse(
                {
                    "type": "error",
                    "message": f"The model provider returned an error ({type(exc).__name__}). "
                    "Please try again.",
                }
            )

        full_text = "".join(parts)
        latency_ms = int((time.monotonic() - started) * 1000)
        if tokens_out == 0 and full_text:
            # Same rough estimate (~4 chars/token) graph_runtime and chat.py
            # fall back to when the provider reports no usage.
            tokens_out = max(1, len(full_text) // 4)
            tokens_in = max(1, (len(agent.system_prompt) + len(user_text)) // 4)

        if full_text or tokens_out:
            try:
                session.add(
                    Message(
                        conversation_id=conversation.id,
                        role="assistant",
                        content=full_text,
                        model=agent.model,
                        tokens_in=tokens_in,
                        tokens_out=tokens_out,
                        cost_usd=cost_usd(agent.model, tokens_in, tokens_out),
                        latency_ms=latency_ms,
                    )
                )
                await session.commit()
            except Exception:
                logger.exception(
                    "failed to persist assistant turn (pydantic-ai runtime) for %s", conversation_id
                )

        if interrupted is not None:
            raise interrupted

        if not errored:
            yield _sse(
                {
                    "type": "done",
                    "usage": {
                        "tokens_in": tokens_in,
                        "tokens_out": tokens_out,
                        "cost_usd": cost_usd(agent.model, tokens_in, tokens_out),
                        "latency_ms": latency_ms,
                    },
                }
            )
