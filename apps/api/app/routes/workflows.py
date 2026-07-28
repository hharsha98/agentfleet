"""REST routes for the visual workflow builder (Stage 2 backend foundation,
chunk 4). Mirrors app/routes/runs.py's conventions exactly: `current_user`
auth, ownership via app.ownership (visibility_clause/is_visible/is_mutable),
the limit/offset + X-Total-Count pagination idiom, deterministic ORDER BY,
and a small serializer helper per resource shape (here: WorkflowSummaryOut/
WorkflowOut, since those schemas already carry computed node_count/
edge_count fields that don't exist as columns on the Workflow model).

Cross-user access always returns 404 (never 403) so existence of another
user's workflow is never leaked — same shape as runs.py. 403 is reserved for
visible-but-not-mutable (a workflow owned by someone else would already be
404'd by the visibility check before is_mutable is even consulted; builtin
workflows don't exist, so is_mutable here really only guards the
legacy-null-vs-owner distinction, kept for symmetry with runs.py).

No rate limiter here, consistent with every other CRUD router — ratelimit.py
only covers chat/upload/public.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.db import get_session
from app.models import Agent, Run, RunTask, User, Workflow
from app.ownership import is_mutable, is_visible, visibility_clause
from app.schemas import (
    WorkflowCreate,
    WorkflowGraphIn,
    WorkflowIssue,
    WorkflowOut,
    WorkflowSummaryOut,
    WorkflowTaskPreview,
    WorkflowUpdate,
    WorkflowValidationOut,
)
from app.services.queue import dispatch_execute
from app.services.workflow_compiler import (
    WorkflowValidationError,
    compile_workflow,
    estimated_waves,
    find_warnings,
)

router = APIRouter()


def _to_summary(w: Workflow) -> WorkflowSummaryOut:
    graph = w.graph or {}
    return WorkflowSummaryOut(
        id=w.id,
        name=w.name,
        description=w.description,
        node_count=len(graph.get("nodes", [])),
        edge_count=len(graph.get("edges", [])),
        created_at=w.created_at,
        updated_at=w.updated_at,
    )


def _to_out(w: Workflow) -> WorkflowOut:
    return WorkflowOut(**_to_summary(w).model_dump(), graph=w.graph or {})


async def _visible_agent_slugs(session: AsyncSession, user: User) -> set[str]:
    """Agent slugs the caller is allowed to reference in a node: their own
    agents, legacy-null-owner agents, or any builtin. Deliberately NOT the
    unfiltered Agent table — using every agent regardless of owner would let
    a user run another user's PRIVATE agent just by typing its slug into a
    node. This is the subtlest security property of the whole feature."""
    rows = (
        await session.execute(select(Agent).where(visibility_clause(Agent, user, builtin=True)))
    ).scalars()
    return {a.slug for a in rows}


@router.post("", status_code=201)
async def create_workflow(
    payload: WorkflowCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> WorkflowOut:
    workflow = Workflow(
        name=payload.name,
        description=payload.description,
        graph=payload.graph.model_dump(),
        user_id=user.id,
    )
    session.add(workflow)
    await session.commit()
    await session.refresh(workflow)
    return _to_out(workflow)


@router.get("")
async def list_workflows(
    response: Response,
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> list[WorkflowSummaryOut]:
    visible = visibility_clause(Workflow, user)
    total = (
        await session.execute(select(func.count()).select_from(Workflow).where(visible))
    ).scalar_one()
    workflows = (
        (
            await session.execute(
                select(Workflow)
                .where(visible)
                .order_by(Workflow.updated_at.desc(), Workflow.id)
                .offset(offset)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    response.headers["X-Total-Count"] = str(total)
    return [_to_summary(w) for w in workflows]


@router.get("/{workflow_id}")
async def get_workflow(
    workflow_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> WorkflowOut:
    workflow = await session.get(Workflow, workflow_id)
    if workflow is None or not is_visible(workflow, user):
        raise HTTPException(status_code=404, detail="Workflow not found")
    return _to_out(workflow)


@router.put("/{workflow_id}")
async def update_workflow(
    workflow_id: uuid.UUID,
    payload: WorkflowUpdate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> WorkflowOut:
    workflow = await session.get(Workflow, workflow_id)
    if workflow is None or not is_visible(workflow, user):
        raise HTTPException(status_code=404, detail="Workflow not found")
    if not is_mutable(workflow, user):
        raise HTTPException(status_code=403, detail="Not permitted to modify this workflow")

    if payload.name is not None:
        workflow.name = payload.name
    if payload.description is not None:
        workflow.description = payload.description
    if payload.graph is not None:
        # Deliberately LENIENT: only Pydantic-level structural validity
        # (WorkflowGraphIn's own field constraints) is enforced here.
        # compile_workflow() is intentionally NOT called from PUT — a graph
        # with a cycle, an unknown agent slug, or zero nodes must still save
        # cleanly, because a builder that refuses to persist work-in-progress
        # is hostile to the author mid-edit. Semantic validation is opt-in,
        # via POST /{workflow_id}/validate (read-only) or
        # POST /{workflow_id}/run (which 422s on a genuinely broken graph).
        workflow.graph = payload.graph.model_dump()

    await session.commit()
    await session.refresh(workflow)
    return _to_out(workflow)


@router.delete("/{workflow_id}")
async def delete_workflow(
    workflow_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> dict:
    workflow = await session.get(Workflow, workflow_id)
    if workflow is None or not is_visible(workflow, user):
        raise HTTPException(status_code=404, detail="Workflow not found")
    if not is_mutable(workflow, user):
        raise HTTPException(status_code=403, detail="Not permitted to modify this workflow")
    await session.delete(workflow)
    await session.commit()
    return {"ok": True}


@router.post("/{workflow_id}/validate")
async def validate_workflow(
    workflow_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> WorkflowValidationOut:
    """Dry-run only — never writes anything (no Run/RunTask rows, no
    workflow mutation)."""
    workflow = await session.get(Workflow, workflow_id)
    if workflow is None or not is_visible(workflow, user):
        raise HTTPException(status_code=404, detail="Workflow not found")

    graph = WorkflowGraphIn.model_validate(workflow.graph)
    valid_slugs = await _visible_agent_slugs(session, user)

    try:
        tasks = compile_workflow(graph, valid_slugs)
    except WorkflowValidationError as exc:
        return WorkflowValidationOut(
            ok=False,
            errors=[WorkflowIssue(code=exc.code, message=exc.message, node_ids=exc.node_ids)],
            warnings=[],
            tasks=[],
            estimated_waves=0,
        )

    # CRITICAL: find_warnings must only ever be called on the success path.
    # It sorts with key=order_index.get, which returns None for a node id
    # that isn't in the node list; on a graph with dangling edges that raises
    # a TypeError comparing None to int. compile_workflow succeeding above
    # already guarantees there are no dangling edges (or cycles, or unknown
    # agents), so it's safe here — never move this above the except block.
    warnings = find_warnings(graph)
    return WorkflowValidationOut(
        ok=True,
        errors=[],
        warnings=warnings,
        tasks=[WorkflowTaskPreview(**t) for t in tasks],
        estimated_waves=estimated_waves(tasks),
    )


@router.post("/{workflow_id}/run", status_code=201)
async def run_workflow(
    workflow_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> dict:
    workflow = await session.get(Workflow, workflow_id)
    if workflow is None or not is_visible(workflow, user):
        raise HTTPException(status_code=404, detail="Workflow not found")
    if not is_mutable(workflow, user):
        raise HTTPException(status_code=403, detail="Not permitted to modify this workflow")

    graph = WorkflowGraphIn.model_validate(workflow.graph)
    # SECURITY: valid_slugs is scoped to agents visible to THIS caller (own +
    # legacy-null + builtin) — see _visible_agent_slugs. Using the unfiltered
    # Agent table here would let a user run another user's private agent by
    # typing its slug into a node.
    valid_slugs = await _visible_agent_slugs(session, user)

    try:
        specs = compile_workflow(graph, valid_slugs)
    except WorkflowValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.message) from exc

    # status="running", not "planning" — there is no planning step for a
    # hand-authored workflow; execute_run computes the terminal status
    # itself once the compiled tasks finish. dispatch_execute (not
    # dispatch_plan) is the whole architectural point: reusing the existing
    # durable executor means this run inherits arq durability, approval
    # pausing, parallel waves, budgets, cost metering, and tracing for free
    # instead of a new hand-rolled execution loop.
    run = Run(
        goal=f"Workflow: {workflow.name}",
        status="running",
        user_id=user.id,
        workflow_id=workflow.id,
    )
    session.add(run)
    await session.flush()
    for spec in specs:
        session.add(RunTask(run_id=run.id, **spec))
    await session.commit()
    await dispatch_execute(run.id)
    return {"run_id": str(run.id), "task_count": len(specs)}
