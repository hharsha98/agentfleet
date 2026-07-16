"""Eval Center routes: golden-case CRUD, running the suite, and run history.

Mounted at /api/v1/agents/{agent_id}/evals — see app/main.py.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Agent, EvalCase, EvalRun
from app.schemas import EvalCaseCreate, EvalCaseOut, EvalRunOut, EvalRunSummaryOut
from app.services.evals import run_eval, run_red_team

router = APIRouter()


@router.get("/cases", response_model=list[EvalCaseOut])
async def list_cases(
    agent_id: uuid.UUID,
    response: Response,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> list[EvalCase]:
    total = (
        await session.execute(
            select(func.count()).select_from(EvalCase).where(EvalCase.agent_id == agent_id)
        )
    ).scalar_one()
    result = await session.execute(
        select(EvalCase)
        .where(EvalCase.agent_id == agent_id)
        .order_by(EvalCase.created_at, EvalCase.id)
        .offset(offset)
        .limit(limit)
    )
    response.headers["X-Total-Count"] = str(total)
    return list(result.scalars().all())


@router.post("/cases", response_model=EvalCaseOut, status_code=201)
async def create_case(
    agent_id: uuid.UUID,
    payload: EvalCaseCreate,
    session: AsyncSession = Depends(get_session),
) -> EvalCase:
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    case = EvalCase(
        agent_id=agent_id,
        input=payload.input,
        expected_contains=payload.expected_contains,
        forbidden_contains=payload.forbidden_contains,
        judge_rubric=payload.judge_rubric,
    )
    session.add(case)
    await session.commit()
    await session.refresh(case)
    return case


@router.delete("/cases/{case_id}")
async def delete_case(
    agent_id: uuid.UUID, case_id: uuid.UUID, session: AsyncSession = Depends(get_session)
) -> dict:
    case = await session.get(EvalCase, case_id)
    if case is None or case.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Eval case not found")
    await session.delete(case)
    await session.commit()
    return {"ok": True}


@router.post("/run", response_model=EvalRunOut)
async def run(agent_id: uuid.UUID, session: AsyncSession = Depends(get_session)) -> EvalRun:
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    # May take seconds: one LLM call per case (plus a judge call per rubric),
    # run sequentially — that's expected for a manual/CI eval gate.
    return await run_eval(session, agent_id)


@router.post("/red-team")
async def red_team(agent_id: uuid.UUID, session: AsyncSession = Depends(get_session)) -> dict:
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    # Adversarial suite, not persisted — one LLM call per case (plus a judge
    # call where a rubric is set), same "expected to take seconds" budget as
    # the regular eval run above.
    return await run_red_team(session, agent_id)


@router.get("/runs", response_model=list[EvalRunSummaryOut])
async def list_runs(
    agent_id: uuid.UUID,
    response: Response,
    limit: int = Query(default=10, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> list[EvalRun]:
    total = (
        await session.execute(
            select(func.count()).select_from(EvalRun).where(EvalRun.agent_id == agent_id)
        )
    ).scalar_one()
    result = await session.execute(
        select(EvalRun)
        .where(EvalRun.agent_id == agent_id)
        .order_by(EvalRun.created_at.desc(), EvalRun.id)
        .offset(offset)
        .limit(limit)
    )
    response.headers["X-Total-Count"] = str(total)
    return list(result.scalars().all())


@router.get("/runs/{run_id}", response_model=EvalRunOut)
async def get_run(
    agent_id: uuid.UUID, run_id: uuid.UUID, session: AsyncSession = Depends(get_session)
) -> EvalRun:
    run_obj = await session.get(EvalRun, run_id)
    if run_obj is None or run_obj.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Eval run not found")
    return run_obj
