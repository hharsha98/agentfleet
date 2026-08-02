"""LangGraph-based agent runtime — the default agent runtime (see
ARCHITECTURE.md ADR-001; toggle via Settings.agent_runtime / AGENT_RUNTIME).

Reuses every proven building block from services/chat.py (the hand-built
loop, kept as the env-switchable fallback): budget checks, the builtin tool
registry (app.tools), MCP dispatch (McpToolbox), guardrails
(wrap_tool_output), and cost metering (app.costs). What changes is *how* the
model<->tools loop runs: instead of chat.py's manual while-loop, this module
compiles a LangGraph StateGraph (model node <-> tools node, conditional
edges, durable Postgres checkpointing per turn via services/checkpointer.py
— see the THREAD-ID TRAP comment below for why "per turn" and not "per
conversation") and streams it.

The SSE wire contract emitted to the client is byte-for-byte identical to
chat.py's: `data: {json}\n\n` frames of type token / tool_call / tool_result
/ guardrail / error / done. A client (or the frontend) cannot tell which
runtime produced the stream.

The small per-turn setup/persistence steps (budget check, history load,
user-message persistence, assistant-message persistence) are intentionally
DUPLICATED from chat.py rather than extracted into a shared module —
chat.py is the battle-tested fallback and must not be edited or risk
behavior drift. The two *constants* that must stay numerically identical
across both runtimes (history window, tool-round cap) are imported from
chat.py directly so there is exactly one source of truth for them.

Robustness parity with chat.py's salvage path: some providers (e.g. Groq)
raise openai.APIError mid-stream when the model emits a malformed tool
call, and a model that keeps calling tools can also blow through
LangGraph's recursion_limit (GraphRecursionError). Either way the turn
would otherwise end with zero tokens and an "error" SSE event even though
useful tool results were already gathered. `_salvage_final_answer` mirrors
chat.py's force_answer step: flatten the tool results gathered so far into
plain-text research notes and make one final, tool-free streamed
completion asking the model to answer from those notes only.
"""

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncGenerator

import openai
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.config import get_stream_writer
from langgraph.errors import GraphRecursionError
from langgraph.graph import END, MessagesState, StateGraph
from sqlalchemy import select

from app.config import get_settings
from app.costs import cost_usd
from app.db import SessionLocal
from app.models import Agent, Conversation, Message
from app.services.budget import check_budget
from app.services.chat import MAX_HISTORY_MESSAGES, MAX_TOOL_ROUNDS
from app.services.checkpointer import get_checkpointer
from app.services.guardrails import wrap_tool_output
from app.services.mcp_client import McpToolbox
from app.tools import run_tool, specs_for

logger = logging.getLogger(__name__)

# A tool round is (model call -> tools call); cap total graph steps so a
# model that keeps calling tools cannot loop forever. Mirrors chat.py's
# MAX_TOOL_ROUNDS while giving LangGraph's own step counter one extra slot
# for the final answer-only model call.
RECURSION_LIMIT = 2 * MAX_TOOL_ROUNDS + 1


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def route_after_model(state: MessagesState) -> str:
    """Conditional edge out of the model node.

    Pure and state-only on purpose (no closures) so it's unit-testable
    without spinning up a model, tools, or a DB session: given a state
    whose last message carries tool_calls, route to "tools"; otherwise the
    model gave its final answer, so route to END.
    """
    last = state["messages"][-1]
    if getattr(last, "tool_calls", None):
        return "tools"
    return END


def tool_specs_for_agent(agent_tools: list, mcp_specs: list[dict]) -> list[dict]:
    """Assemble the OpenAI-format tool specs the model is bound to: the
    agent's opted-in builtin tools (app.tools.specs_for) plus every tool
    exposed by its connected MCP servers (McpToolbox.specs)."""
    return specs_for(agent_tools or []) + list(mcp_specs)


def _build_graph(
    model,
    mcp_toolbox: McpToolbox,
    tool_log: list[dict],
    findings_texts: list[str],
    checkpointer,
    user_id: uuid.UUID | None = None,
):
    """Compile a fresh StateGraph for one chat turn. The model and
    mcp_toolbox are per-request (bound to this agent's config and this
    turn's live MCP connections), so the graph is built per call rather
    than cached — compilation is cheap relative to a model round-trip.

    checkpointer is the process-wide singleton from services/checkpointer.py
    (obtained via `await get_checkpointer()` in the async request path, not
    at import time) — durable Postgres by default, or a MemorySaver
    fallback. It is NOT created here: a fresh pool per chat turn would
    exhaust Postgres connections and defeat the point of a shared saver.

    findings_texts accumulates the same (name, args, output) research notes
    chat.py's findings_texts does, so that if the run aborts mid-loop
    (openai.APIError / GraphRecursionError) the caller can flatten whatever
    was gathered so far into the salvage completion's research notes.
    """

    async def call_model(state: MessagesState) -> dict:
        response = await model.ainvoke(state["messages"])
        return {"messages": [response]}

    async def call_tools(state: MessagesState) -> dict:
        # Custom node (not prebuilt ToolNode) so every result passes through
        # our guardrails and MCP dispatch, exactly like chat.py's loop.
        last = state["messages"][-1]
        tool_calls = getattr(last, "tool_calls", None) or []
        writer = get_stream_writer()
        tool_messages: list[ToolMessage] = []
        for tc in tool_calls:
            name = tc.get("name", "")
            args = tc.get("args") or {}
            call_id = tc.get("id", "")
            writer({"sse_type": "tool_call", "name": name, "arguments": args})
            if name.startswith("mcp_"):
                result = await mcp_toolbox.call(name, args)
            else:
                result = await run_tool(name, args, user_id=user_id)
            guarded, flags = wrap_tool_output(result)
            if flags:
                writer({"sse_type": "guardrail", "tool": name, "flags": flags})
            tool_log.append(
                {"name": name, "arguments": args, "result_preview": guarded[:500]}
            )
            findings_texts.append(
                f"[{name} {json.dumps(args, ensure_ascii=False)}]\n{guarded[:2000]}"
            )
            writer({"sse_type": "tool_result", "name": name, "preview": guarded[:300]})
            tool_messages.append(ToolMessage(content=guarded[:4000], tool_call_id=call_id))
        return {"messages": tool_messages}

    graph = StateGraph(MessagesState)
    graph.add_node("model", call_model)
    graph.add_node("tools", call_tools)
    graph.set_entry_point("model")
    graph.add_conditional_edges("model", route_after_model, {"tools": "tools", END: END})
    graph.add_edge("tools", "model")
    return graph.compile(checkpointer=checkpointer)


async def _salvage_final_answer(
    *,
    model_name: str,
    base_url: str,
    api_key: str,
    temperature: float,
    system_prompt: str,
    user_text: str,
    findings_texts: list[str],
) -> AsyncGenerator[dict, None]:
    """One final, tool-free streamed completion used to salvage a turn after
    the provider aborts mid-tool-loop (openai.APIError) or the graph hits
    its recursion cap (GraphRecursionError) — the LangGraph counterpart of
    chat.py's force_answer path. Flattens whatever tool output was gathered
    into plain-text research notes and asks the model, with no tools bound,
    to give its best final answer from those notes alone.

    Yields {"kind": "token", "content": str} for each streamed text chunk
    and {"kind": "usage", "tokens_in": int, "tokens_out": int} whenever the
    provider reports usage, so the caller can turn tokens into SSE frames
    and accumulate metering without this function touching SSE directly.
    """
    notes = "\n\n".join(findings_texts) if findings_texts else "No tool results were gathered."
    salvage_messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_text),
        SystemMessage(
            content=(
                "Tool access for this turn is finished. Using ONLY the research "
                "notes below, give your best final answer now; cite any URLs "
                "already found; do not request tools.\n\nResearch notes:\n" + notes
            )
        ),
    ]
    # No .bind_tools() call here — that's the whole point: strip tool
    # bindings so a strict provider cannot reject or re-attempt tool syntax.
    salvage_model = ChatOpenAI(
        model=model_name,
        base_url=base_url,
        api_key=api_key,
        temperature=temperature,
        streaming=True,
        stream_usage=True,
    )
    async for chunk in salvage_model.astream(salvage_messages):
        content = chunk.content
        if isinstance(content, str) and content:
            yield {"kind": "token", "content": content}
        usage = getattr(chunk, "usage_metadata", None)
        if usage:
            yield {
                "kind": "usage",
                "tokens_in": usage.get("input_tokens") or 0,
                "tokens_out": usage.get("output_tokens") or 0,
            }


async def stream_chat_graph(conversation_id: uuid.UUID, user_text: str) -> AsyncGenerator[str, None]:
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
            history = list(reversed(recent))

            lc_messages: list = [SystemMessage(content=agent.system_prompt)]
            for m in history:
                if m.role == "user" and m.content:
                    lc_messages.append(HumanMessage(content=m.content))
                elif m.role == "assistant" and m.content:
                    lc_messages.append(AIMessage(content=m.content))
            lc_messages.append(HumanMessage(content=user_text))

            session.add(Message(conversation_id=conversation.id, role="user", content=user_text))
            await session.commit()
        except Exception:
            logger.exception("graph chat setup failed for conversation %s", conversation_id)
            yield _sse({"type": "error", "message": "Could not start the reply. Please try again."})
            return

        settings = get_settings()
        tool_log: list[dict] = []
        findings_texts: list[str] = []  # fuller tool output, for the salvage path
        started = time.monotonic()
        parts: list[str] = []
        tokens_in = tokens_out = 0
        errored = False
        interrupted: BaseException | None = None

        async with McpToolbox(agent.mcp_servers or []) as mcp_toolbox:
            tool_specs = tool_specs_for_agent(agent.tools, mcp_toolbox.specs)

            model = ChatOpenAI(
                model=agent.model,
                base_url=settings.free_llm_base_url,
                api_key=settings.free_llm_key,
                temperature=agent.temperature,
                streaming=True,
                stream_usage=True,
            )
            if tool_specs:
                model = model.bind_tools(tool_specs)

            checkpointer = await get_checkpointer()
            graph = _build_graph(
                model, mcp_toolbox, tool_log, findings_texts, checkpointer, conversation.user_id
            )
            # THREAD-ID TRAP: this runtime already loads the full
            # conversation history from the messages table and re-seeds it
            # as `lc_messages` on every turn (see above). LangGraph's
            # add_messages reducer APPENDS new input to whatever the
            # checkpointer already has for a thread_id — so if thread_id
            # were stable per-conversation, turn 2 would contain turn 1's
            # checkpointed messages PLUS the manually-reseeded history
            # again, duplicating messages and inflating token cost every
            # turn. Using a fresh, unique thread_id per turn keeps each
            # turn's graph execution durable in Postgres (satisfying the
            # "survives a restart/replica" requirement) without ever
            # accumulating cross-turn state in the checkpointer — the
            # messages table remains the single source of conversation
            # memory, unchanged from before this change.
            thread_id = f"{conversation_id}:{uuid.uuid4().hex}"
            config = {
                "configurable": {"thread_id": thread_id},
                "recursion_limit": RECURSION_LIMIT,
            }

            try:
                async for mode, payload in graph.astream(
                    {"messages": lc_messages},
                    config=config,
                    stream_mode=["messages", "custom"],
                ):
                    if mode == "custom":
                        sse_type = payload.get("sse_type")
                        if sse_type == "tool_call":
                            yield _sse(
                                {
                                    "type": "tool_call",
                                    "name": payload["name"],
                                    "arguments": payload["arguments"],
                                }
                            )
                        elif sse_type == "tool_result":
                            yield _sse(
                                {
                                    "type": "tool_result",
                                    "name": payload["name"],
                                    "preview": payload["preview"],
                                }
                            )
                        elif sse_type == "guardrail":
                            yield _sse(
                                {
                                    "type": "guardrail",
                                    "tool": payload["tool"],
                                    "flags": payload["flags"],
                                }
                            )
                        continue

                    # mode == "messages": payload is (chunk, metadata); only
                    # the model node's own chunks are token output — the
                    # tools node never streams text through this channel.
                    chunk, metadata = payload
                    if metadata.get("langgraph_node") != "model":
                        continue
                    content = chunk.content
                    if isinstance(content, str) and content:
                        parts.append(content)
                        yield _sse({"type": "token", "content": content})
                    usage = getattr(chunk, "usage_metadata", None)
                    if usage:
                        tokens_in += usage.get("input_tokens") or 0
                        tokens_out += usage.get("output_tokens") or 0
            except (openai.APIError, GraphRecursionError) as exc:
                # Two ways a tool-calling turn can abort without a final
                # answer: the provider aborts the stream on a malformed tool
                # call (openai.APIError — e.g. Groq's "Parsing failed"), or
                # the model keeps calling tools until the graph's
                # recursion_limit trips (GraphRecursionError). Either way,
                # don't just report an error — salvage the turn the way
                # chat.py's force_answer path does: drop tool bindings and
                # ask the model for one final answer from the notes already
                # gathered.
                if isinstance(exc, GraphRecursionError):
                    logger.warning(
                        "graph tool loop hit recursion limit for conversation %s",
                        conversation_id,
                    )
                else:
                    logger.warning(
                        "provider error mid-run for %s; salvaging turn",
                        conversation_id,
                        exc_info=True,
                    )
                try:
                    async for evt in _salvage_final_answer(
                        model_name=agent.model,
                        base_url=settings.free_llm_base_url,
                        api_key=settings.free_llm_key,
                        temperature=agent.temperature,
                        system_prompt=agent.system_prompt,
                        user_text=user_text,
                        findings_texts=findings_texts,
                    ):
                        if evt["kind"] == "token":
                            parts.append(evt["content"])
                            yield _sse({"type": "token", "content": evt["content"]})
                        else:
                            tokens_in += evt["tokens_in"]
                            tokens_out += evt["tokens_out"]
                except Exception as salvage_exc:
                    # Even the tool-free salvage completion failed — nothing
                    # left to recover, report it (sanitized, like every other
                    # provider-error path here).
                    errored = True
                    logger.exception(
                        "salvage completion failed for conversation %s", conversation_id
                    )
                    yield _sse(
                        {
                            "type": "error",
                            "message": (
                                "The model provider returned an error "
                                f"({type(salvage_exc).__name__}). Please try again."
                            ),
                        }
                    )
            except (asyncio.CancelledError, GeneratorExit) as exc:
                # Client disconnected mid-stream — persist the partial turn
                # below, then re-raise so the ASGI layer sees the cancellation.
                interrupted = exc
            except Exception as exc:
                # Full details go to the server log only — provider
                # exceptions can embed key fragments and internal URLs.
                errored = True
                logger.exception("graph run failed for conversation %s", conversation_id)
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
            # Provider sent no usage — rough estimate (~4 chars per token),
            # same fallback chat.py uses.
            tokens_out = max(1, len(full_text) // 4)
            tokens_in = max(1, sum(len(m.content or "") for m in lc_messages) // 4)

        if full_text or tokens_out:
            try:
                session.add(
                    Message(
                        conversation_id=conversation.id,
                        role="assistant",
                        content=full_text,
                        tool_calls=tool_log or None,
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
                    "failed to persist assistant turn (graph runtime) for %s", conversation_id
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
