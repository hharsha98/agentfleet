"""Prompt Playground (Phase 10 L): run one-off A/B completions and optionally
save the pair for later comparison.

POST /run is intentionally stateless and fast — it does exactly one
non-streaming provider call (no tools, no conversation/agent lookup) and
returns. The frontend fires it twice in parallel, once per variant, so a
slow or failing variant never blocks the other (see chat.py's stream_chat
for the richer, stateful sibling of this — same metering, no tool loop).

Reuses the exact machinery chat.py's stream_chat uses to produce a completion
and compute usage: app.providers.get_llm_client() for the OpenAI-compatible
client, app.costs.cost_usd() for pricing, and the same "estimate ~4 chars/
token if the provider omits usage" fallback.
"""

import logging
import time
import uuid

import openai
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.config import get_settings
from app.costs import cost_usd
from app.db import get_session
from app.models import PlaygroundExperiment, User
from app.providers import get_llm_client
from app.schemas import (
    PlaygroundExperimentCreate,
    PlaygroundExperimentOut,
    PlaygroundModelsOut,
    PlaygroundRunRequest,
    PlaygroundRunResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_EXPERIMENTS_LISTED = 50


@router.post("/run", response_model=PlaygroundRunResponse)
async def run_playground(
    payload: PlaygroundRunRequest, user: User = Depends(current_user)
) -> dict:
    client = get_llm_client()
    messages: list[dict] = []
    if payload.system_prompt:
        messages.append({"role": "system", "content": payload.system_prompt})
    messages.append({"role": "user", "content": payload.user_message})

    kwargs: dict = {
        "model": payload.model,
        "messages": messages,
        "temperature": payload.temperature,
        "stream": False,
    }
    if payload.max_tokens is not None:
        kwargs["max_tokens"] = payload.max_tokens

    started = time.monotonic()
    try:
        completion = await client.chat.completions.create(**kwargs)
    except openai.APIError as exc:
        # Full details go to the server log; the frontend shows a per-variant
        # inline error so the developer sees which of A/B failed and why
        # (bad model name, rate limit, etc.) without one variant's failure
        # breaking the other panel.
        logger.warning("playground run failed for model %s", payload.model, exc_info=True)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    latency_ms = int((time.monotonic() - started) * 1000)

    output = completion.choices[0].message.content or "" if completion.choices else ""
    usage = completion.usage
    tokens_in = usage.prompt_tokens if usage else 0
    tokens_out = usage.completion_tokens if usage else 0
    if not usage:
        # Same rough ~4-chars/token estimate services/chat.py falls back to
        # when a provider sends no usage block.
        tokens_out = max(1, len(output) // 4)
        tokens_in = max(1, (len(payload.system_prompt) + len(payload.user_message)) // 4)

    return {
        "output": output,
        "usage": {
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd(payload.model, tokens_in, tokens_out),
            "latency_ms": latency_ms,
        },
    }


@router.get("/models", response_model=PlaygroundModelsOut)
async def list_playground_models(user: User = Depends(current_user)) -> dict:
    """Best-effort model list for the frontend's <datalist>. Must never raise
    — the model field stays free-text either way, so a failed/empty listing
    only costs autocomplete, not functionality."""
    settings = get_settings()
    try:
        client = get_llm_client()
        response = await client.models.list()
        models = sorted({m.id for m in response.data if getattr(m, "id", None)})
        if models:
            return {"models": models}
    except Exception:
        logger.warning("playground: provider models.list() failed; using config fallback", exc_info=True)

    # Fallback: the default/planner model names from config, de-duplicated,
    # order preserved (default first).
    candidates = [m for m in (settings.default_model, settings.planner_model) if m]
    seen: set[str] = set()
    deduped = [m for m in candidates if not (m in seen or seen.add(m))]
    return {"models": deduped}


@router.post("/experiments", response_model=PlaygroundExperimentOut, status_code=201)
async def create_experiment(
    payload: PlaygroundExperimentCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> PlaygroundExperiment:
    experiment = PlaygroundExperiment(
        title=payload.title,
        system_prompt=payload.system_prompt,
        user_message=payload.user_message,
        variant_a=payload.variant_a.model_dump(),
        variant_b=payload.variant_b.model_dump(),
    )
    session.add(experiment)
    await session.commit()
    await session.refresh(experiment)
    return experiment


@router.get("/experiments")
async def list_experiments(
    response: Response,
    limit: int = Query(default=MAX_EXPERIMENTS_LISTED, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> list[dict]:
    total = (
        await session.execute(select(func.count()).select_from(PlaygroundExperiment))
    ).scalar_one()
    result = await session.execute(
        select(PlaygroundExperiment)
        .order_by(PlaygroundExperiment.created_at.desc(), PlaygroundExperiment.id)
        .offset(offset)
        .limit(limit)
    )
    experiments = result.scalars().all()
    response.headers["X-Total-Count"] = str(total)
    # Lightweight on purpose (spec: "keep list lightweight") — omit the full
    # prompts/outputs, which the detail endpoint below returns in full.
    return [
        {
            "id": str(e.id),
            "title": e.title,
            "created_at": e.created_at.isoformat(),
            "models": [e.variant_a.get("model"), e.variant_b.get("model")],
        }
        for e in experiments
    ]


@router.get("/experiments/{experiment_id}", response_model=PlaygroundExperimentOut)
async def get_experiment(
    experiment_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> PlaygroundExperiment:
    experiment = await session.get(PlaygroundExperiment, experiment_id)
    if experiment is None:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return experiment
