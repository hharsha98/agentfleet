"""Streaming chat: load agent + history, stream the LLM, persist both turns.

Every assistant message is metered (tokens, cost, latency) — the raw data
behind the cost dashboard and budget caps. Hardened per the 2026-07-10
adversarial review: capped history replay, sanitized error output, and
metering that survives client disconnects.
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

logger = logging.getLogger(__name__)

# Newest turns win: cap what we replay to the provider so a long conversation
# cannot grow per-request token cost without bound (groundwork for P7 budgets).
MAX_HISTORY_MESSAGES = 30


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

            llm_messages = [{"role": "system", "content": agent.system_prompt}]
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

        client = get_llm_client()
        started = time.monotonic()
        parts: list[str] = []
        tokens_in = tokens_out = 0
        errored = False
        interrupted: BaseException | None = None

        try:
            try:
                stream = await client.chat.completions.create(
                    model=agent.model,
                    messages=llm_messages,
                    temperature=agent.temperature,
                    stream=True,
                    stream_options={"include_usage": True},
                )
            except (TypeError, openai.BadRequestError):
                # Only these mean "provider rejects stream_options" — anything
                # else (auth, network) must propagate, not trigger a second call.
                stream = await client.chat.completions.create(
                    model=agent.model,
                    messages=llm_messages,
                    temperature=agent.temperature,
                    stream=True,
                )
            async for chunk in stream:
                if getattr(chunk, "usage", None):
                    tokens_in = chunk.usage.prompt_tokens or 0
                    tokens_out = chunk.usage.completion_tokens or 0
                if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                    piece = chunk.choices[0].delta.content
                    parts.append(piece)
                    yield _sse({"type": "token", "content": piece})
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
            tokens_in = max(1, sum(len(m["content"]) for m in llm_messages) // 4)

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
