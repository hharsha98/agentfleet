"""Streaming chat with tool use: load agent + history, run the model in
rounds (answer → tool calls → tool results → answer …), persist both turns.

Every assistant message is metered (tokens, cost, latency) — the raw data
behind the cost dashboard and budget caps. Hardened per the 2026-07-10
adversarial review plus live failure testing: capped history replay,
sanitized error output, disconnect-safe metering, and a salvage path for
providers that abort the stream on malformed model tool calls.
"""

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncGenerator

import openai
from sqlalchemy import select

from app.costs import cost_usd
from app.db import SessionLocal
from app.models import Agent, Conversation, Message
from app.providers import get_llm_client
from app.services.budget import check_budget
from app.services.guardrails import wrap_tool_output
from app.services.mcp_client import McpToolbox
from app.tools import run_tool, specs_for

logger = logging.getLogger(__name__)

# Newest turns win: cap what we replay to the provider so a long conversation
# cannot grow per-request token cost without bound (groundwork for P7 budgets).
MAX_HISTORY_MESSAGES = 30
# Hard stop for agentic loops — a model that keeps calling tools gets cut off.
MAX_TOOL_ROUNDS = 5

FINAL_ANSWER_NOTE = (
    "Tool access for this turn is finished. Give your best final answer now, "
    "using only the information gathered above. Cite any URLs already found. "
    "Do not request or mention tools."
)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def stream_chat(conversation_id: uuid.UUID, user_text: str) -> AsyncGenerator[str, None]:
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

            llm_messages: list[dict] = [{"role": "system", "content": agent.system_prompt}]
            llm_messages += [
                {"role": m.role, "content": m.content}
                for m in history
                if m.role in ("user", "assistant") and m.content
            ]
            llm_messages.append({"role": "user", "content": user_text})

            session.add(Message(conversation_id=conversation.id, role="user", content=user_text))
            await session.commit()
        except Exception:
            logger.exception("chat setup failed for conversation %s", conversation_id)
            yield _sse({"type": "error", "message": "Could not start the reply. Please try again."})
            return

        tool_specs = specs_for(agent.tools or [])
        tool_log: list[dict] = []
        findings_texts: list[str] = []  # fuller tool output, for forced-answer notes
        client = get_llm_client()
        started = time.monotonic()
        parts: list[str] = []
        tokens_in = tokens_out = 0
        errored = False
        interrupted: BaseException | None = None

        async with McpToolbox(agent.mcp_servers or []) as mcp_toolbox:
            tool_specs = tool_specs + mcp_toolbox.specs
            try:
                round_index = 0
                force_answer = False
                final_note_added = False
                while round_index <= MAX_TOOL_ROUNDS:
                    if round_index == MAX_TOOL_ROUNDS:
                        force_answer = True
                    if force_answer and not final_note_added:
                        # Flatten tool traffic into plain text: reasoning models on
                        # strict providers keep emitting tool syntax as long as tool
                        # artifacts remain in history — a plain-chat request cannot
                        # be rejected for tool-call validation.
                        notes = (
                            "\n\n".join(findings_texts)
                            if findings_texts
                            else "No tool results were gathered."
                        )
                        llm_messages = [
                            m
                            for m in llm_messages
                            if m["role"] in ("system", "user", "assistant")
                            and not m.get("tool_calls")
                        ]
                        llm_messages.append(
                            {
                                "role": "system",
                                "content": f"Research notes gathered this turn:\n{notes}\n\n"
                                + FINAL_ANSWER_NOTE,
                            }
                        )
                        final_note_added = True

                    kwargs: dict = {
                        "model": agent.model,
                        "messages": llm_messages,
                        "temperature": agent.temperature,
                        "stream": True,
                    }
                    if tool_specs and not force_answer:
                        kwargs["tools"] = tool_specs

                    round_text: list[str] = []
                    pending: dict[int, dict] = {}
                    crashed = False
                    try:
                        try:
                            stream = await client.chat.completions.create(
                                **kwargs, stream_options={"include_usage": True}
                            )
                        except (TypeError, openai.BadRequestError):
                            # Only these mean "provider rejects stream_options" — anything
                            # else (auth, network) must propagate, not trigger a second call.
                            stream = await client.chat.completions.create(**kwargs)

                        async for chunk in stream:
                            if getattr(chunk, "usage", None):
                                tokens_in += chunk.usage.prompt_tokens or 0
                                tokens_out += chunk.usage.completion_tokens or 0
                            delta = chunk.choices[0].delta if chunk.choices else None
                            if delta is None:
                                continue
                            if delta.content:
                                round_text.append(delta.content)
                                parts.append(delta.content)
                                yield _sse({"type": "token", "content": delta.content})
                            # Tool-call arguments stream in fragments — accumulate by index.
                            for tc in delta.tool_calls or []:
                                slot = pending.setdefault(
                                    tc.index, {"id": "", "name": "", "args": ""}
                                )
                                if tc.id:
                                    slot["id"] = tc.id
                                if tc.function and tc.function.name:
                                    slot["name"] = tc.function.name
                                if tc.function and tc.function.arguments:
                                    slot["args"] += tc.function.arguments
                    except openai.APIError:
                        if force_answer:
                            raise  # nothing left to salvage — outer handler reports it
                        # Some providers (e.g. Groq) abort the stream when the model
                        # emits a malformed tool call. Execute the calls that DID
                        # complete, then force a text answer from their results.
                        logger.warning(
                            "provider error mid-round for %s; salvaging turn",
                            conversation_id,
                            exc_info=True,
                        )
                        crashed = True

                    # Keep only complete, well-formed calls (garbled ones upset
                    # strict providers when replayed and cannot be executed anyway).
                    calls: list[dict] = []
                    for i in sorted(pending):
                        c = pending[i]
                        if not (c["name"] and c["id"]):
                            continue
                        try:
                            c["parsed_args"] = json.loads(c["args"] or "{}")
                        except json.JSONDecodeError:
                            continue
                        calls.append(c)

                    if not crashed and not pending:
                        break  # the model produced its final answer

                    if calls:
                        llm_messages.append(
                            {
                                "role": "assistant",
                                "content": "".join(round_text) or None,
                                "tool_calls": [
                                    {
                                        "id": c["id"],
                                        "type": "function",
                                        "function": {
                                            "name": c["name"],
                                            "arguments": json.dumps(c["parsed_args"]),
                                        },
                                    }
                                    for c in calls
                                ],
                            }
                        )
                        for c in calls:
                            args = c["parsed_args"]
                            yield _sse({"type": "tool_call", "name": c["name"], "arguments": args})
                            if c["name"].startswith("mcp_"):
                                result = await mcp_toolbox.call(c["name"], args)
                            else:
                                result = await run_tool(c["name"], args)
                            result, guardrail_hits = wrap_tool_output(result)
                            if guardrail_hits:
                                yield _sse(
                                    {
                                        "type": "guardrail",
                                        "tool": c["name"],
                                        "flags": guardrail_hits,
                                    }
                                )
                            tool_log.append(
                                {
                                    "name": c["name"],
                                    "arguments": args,
                                    "result_preview": result[:500],
                                }
                            )
                            findings_texts.append(
                                f"[{c['name']} {json.dumps(args, ensure_ascii=False)}]\n"
                                f"{result[:2000]}"
                            )
                            yield _sse(
                                {"type": "tool_result", "name": c["name"], "preview": result[:300]}
                            )
                            llm_messages.append(
                                {"role": "tool", "tool_call_id": c["id"], "content": result[:4000]}
                            )

                    if crashed or not calls:
                        force_answer = True
                    round_index += 1
            except (asyncio.CancelledError, GeneratorExit) as exc:
                # Client disconnected mid-stream. Fall through to persist the
                # partial turn (tokens were consumed either way), then re-raise.
                interrupted = exc
            except Exception as exc:
                # Full details go to the server log ONLY — provider exceptions can
                # embed key fragments and internal URLs (review finding).
                errored = True
                logger.exception("provider stream failed for conversation %s", conversation_id)
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
            # Provider sent no usage — rough estimate (~4 chars per token).
            tokens_out = max(1, len(full_text) // 4)
            tokens_in = max(1, sum(len(str(m.get("content") or "")) for m in llm_messages) // 4)

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
                logger.exception("failed to persist assistant turn for %s", conversation_id)

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
