"""Tests for app/services/workflow_compiler.py — the DAG compiler that turns
a human-authored Workflow graph into RunTask-shaped dicts — and (below the
compiler section) for the REST routes in app/routes/workflows.py that wrap
it (Stage 2 backend foundation, chunk 4).

Fully hermetic, like test_orchestrator.py: pure functions over Pydantic
objects, no DB, no HTTP, no LLM. compile_workflow/estimated_waves/
find_warnings never touch the database or the network, so these tests build
WorkflowGraphIn objects directly and assert on the returned dicts/exceptions.

The route tests below follow tests/test_run_tasks.py's style: RawAsyncClient
+ ASGITransport + direct ORM setup (never POST /runs, which would kick off
the real orchestrator). `dispatch_execute` is monkeypatched with an async
recorder so nothing here ever touches arq/Redis or an LLM.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport
from sqlalchemy import func, select

from app.db import SessionLocal, engine
from app.main import app
from app.models import Agent, Run, RunTask, User, Workflow
from app.schemas import WorkflowEdgeIn, WorkflowGraphIn, WorkflowNodeIn
from app.services.workflow_compiler import (
    WorkflowValidationError,
    compile_workflow,
    estimated_waves,
    find_warnings,
)
from tests.conftest import RawAsyncClient, mint_token

SLUGS = {"orchestrator", "deep-research", "creative-writer"}


def _node(
    node_id: str,
    *,
    agent_slug: str = "orchestrator",
    title: str | None = None,
    needs_approval: bool = False,
) -> WorkflowNodeIn:
    return WorkflowNodeIn(
        id=node_id,
        agent_slug=agent_slug,
        title=title or node_id,
        instruction=f"do {node_id}",
        needs_approval=needs_approval,
    )


def _edge(source: str, target: str) -> WorkflowEdgeIn:
    return WorkflowEdgeIn(id=f"{source}-{target}", source=source, target=target)


def _graph(nodes: list[WorkflowNodeIn], edges: list[WorkflowEdgeIn]) -> WorkflowGraphIn:
    return WorkflowGraphIn(nodes=nodes, edges=edges)


# --- happy path: ordering ------------------------------------------------------


def test_linear_chain_declared_in_reverse_compiles_in_dependency_order() -> None:
    # Declared C, B, A on the canvas but the edges say A -> B -> C. A strict
    # chain never has a tie to break, so declaration order must not matter.
    nodes = [_node("C"), _node("B"), _node("A")]
    edges = [_edge("A", "B"), _edge("B", "C")]
    tasks = compile_workflow(_graph(nodes, edges), SLUGS)
    assert [t["ordinal"] for t in tasks] == [0, 1, 2]
    assert [t["title"] for t in tasks] == ["A", "B", "C"]
    assert [t["depends_on"] for t in tasks] == [[], [0], [1]]


def test_diamond_join_depends_on_both_branches() -> None:
    # A -> B, A -> C, B -> D, C -> D. Declared in natural order, so the
    # deterministic tie-break (B before C) is exercised too.
    nodes = [_node("A"), _node("B"), _node("C"), _node("D")]
    edges = [_edge("A", "B"), _edge("A", "C"), _edge("B", "D"), _edge("C", "D")]
    tasks = compile_workflow(_graph(nodes, edges), SLUGS)
    by_title = {t["title"]: t for t in tasks}
    assert by_title["D"]["depends_on"] == [1, 2]


# --- rejections ------------------------------------------------------------


def test_cycle_is_rejected_and_names_the_nodes() -> None:
    nodes = [_node("A"), _node("B"), _node("C")]
    edges = [_edge("A", "B"), _edge("B", "C"), _edge("C", "A")]
    with pytest.raises(WorkflowValidationError) as exc_info:
        compile_workflow(_graph(nodes, edges), SLUGS)
    assert exc_info.value.code == "cycle"
    assert set(exc_info.value.node_ids) == {"A", "B", "C"}
    for name in ("A", "B", "C"):
        assert name in exc_info.value.message


def test_self_loop_is_rejected() -> None:
    nodes = [_node("A"), _node("B")]
    edges = [_edge("A", "B"), _edge("A", "A")]
    with pytest.raises(WorkflowValidationError) as exc_info:
        compile_workflow(_graph(nodes, edges), SLUGS)
    assert exc_info.value.code == "self_loop"
    assert exc_info.value.node_ids == ["A"]


def test_unknown_agent_is_rejected_not_coerced() -> None:
    # CONTRAST with orchestrator.parse_plan: parse_plan silently falls back
    # an unrecognized LLM-emitted slug to "orchestrator". A human-authored
    # graph must not get that same silent treatment — it must be a hard
    # error the author can see and fix.
    nodes = [_node("A", agent_slug="not-a-real-agent")]
    with pytest.raises(WorkflowValidationError) as exc_info:
        compile_workflow(_graph(nodes, []), SLUGS)
    assert exc_info.value.code == "unknown_agent"
    assert exc_info.value.node_ids == ["A"]


def test_dangling_edge_is_rejected() -> None:
    nodes = [_node("A")]
    edges = [_edge("A", "ghost")]
    with pytest.raises(WorkflowValidationError) as exc_info:
        compile_workflow(_graph(nodes, edges), SLUGS)
    assert exc_info.value.code == "dangling_edge"
    assert "ghost" in exc_info.value.node_ids


def test_duplicate_node_id_is_rejected() -> None:
    nodes = [_node("A", title="First"), _node("A", title="Second")]
    with pytest.raises(WorkflowValidationError) as exc_info:
        compile_workflow(_graph(nodes, []), SLUGS)
    assert exc_info.value.code == "duplicate_id"
    assert exc_info.value.node_ids == ["A"]


# --- the machine-checked contract with execute_run --------------------------


def test_contract_twelve_node_dag_satisfies_depends_on_invariant() -> None:
    """execute_run computes `set(t.depends_on or []) <= done`, which only
    makes sense if every dep is a strictly-earlier ordinal. This is the
    property compile_workflow's INVARIANT comment claims Kahn's algorithm
    guarantees — assert it holds on a graph big enough, and declared out of
    order enough, to actually exercise it."""
    ids = [f"n{i}" for i in range(12)]
    declared_order = ids[::-1]  # authored back-to-front on purpose
    nodes = [_node(nid) for nid in declared_order]
    edges = [_edge(f"n{i}", f"n{i + 1}") for i in range(11)]
    # A few extra cross-links, all still lower-index -> higher-index so the
    # graph stays acyclic no matter how it's declared.
    edges += [_edge("n0", "n5"), _edge("n2", "n8"), _edge("n3", "n11"), _edge("n1", "n9")]

    tasks = compile_workflow(_graph(nodes, edges), SLUGS)
    assert len(tasks) == 12
    for t in tasks:
        i = t["ordinal"]
        assert all(0 <= d < i for d in t["depends_on"])


def test_ten_node_chain_exceeds_max_plan_tasks_but_compiles_fully() -> None:
    """orchestrator.MAX_PLAN_TASKS caps the LLM planner at 6 tasks per plan.
    The compiler must not inherit that cap — regression guard."""
    ids = [f"n{i}" for i in range(10)]
    nodes = [_node(nid) for nid in ids]
    edges = [_edge(ids[i], ids[i + 1]) for i in range(9)]
    tasks = compile_workflow(_graph(nodes, edges), SLUGS)
    assert len(tasks) == 10
    assert [t["depends_on"] for t in tasks] == [[]] + [[i] for i in range(9)]


def test_compiling_twice_is_deterministic() -> None:
    nodes = [_node("A"), _node("B"), _node("C"), _node("D")]
    edges = [_edge("A", "B"), _edge("A", "C"), _edge("B", "D"), _edge("C", "D")]
    graph = _graph(nodes, edges)
    assert compile_workflow(graph, SLUGS) == compile_workflow(graph, SLUGS)


def test_estimated_waves_matches_longest_path() -> None:
    diamond_nodes = [_node("A"), _node("B"), _node("C"), _node("D")]
    diamond_edges = [_edge("A", "B"), _edge("A", "C"), _edge("B", "D"), _edge("C", "D")]
    diamond_tasks = compile_workflow(_graph(diamond_nodes, diamond_edges), SLUGS)
    # Longest path A -> B -> D (or A -> C -> D) is 3 nodes deep.
    assert estimated_waves(diamond_tasks) == 3

    chain_nodes = [_node("X"), _node("Y"), _node("Z")]
    chain_edges = [_edge("X", "Y"), _edge("Y", "Z")]
    chain_tasks = compile_workflow(_graph(chain_nodes, chain_edges), SLUGS)
    assert estimated_waves(chain_tasks) == 3


def test_orphan_node_and_wide_fan_in_are_warnings_not_errors() -> None:
    nodes = [_node("A"), _node("B"), _node("C"), _node("D"), _node("E"), _node("ORPHAN")]
    edges = [_edge("A", "E"), _edge("B", "E"), _edge("C", "E"), _edge("D", "E")]
    graph = _graph(nodes, edges)

    # Legal graph — compiles without error.
    tasks = compile_workflow(graph, SLUGS)
    e_task = next(t for t in tasks if t["title"] == "E")
    assert len(e_task["depends_on"]) == 4

    warnings = find_warnings(graph)
    codes = {w.code for w in warnings}
    assert codes == {"orphan_node", "wide_fan_in"}
    assert next(w for w in warnings if w.code == "orphan_node").node_ids == ["ORPHAN"]
    assert next(w for w in warnings if w.code == "wide_fan_in").node_ids == ["E"]


def test_empty_instruction_yields_warning_but_still_compiles() -> None:
    # A blank instruction and a whitespace-only one both count as "empty" —
    # only C (a real instruction) should be exempt. Legal either way: the
    # graph still compiles (warnings never block), it just gets flagged.
    blank = WorkflowNodeIn(
        id="A", agent_slug="orchestrator", title="Clinical Research", instruction=""
    )
    whitespace_only = WorkflowNodeIn(
        id="B", agent_slug="orchestrator", title="B", instruction="   \n\t  "
    )
    filled = _node("C")
    nodes = [blank, whitespace_only, filled]
    edges = [_edge("A", "C"), _edge("B", "C")]
    graph = _graph(nodes, edges)

    tasks = compile_workflow(graph, SLUGS)
    assert len(tasks) == 3
    by_title = {t["title"]: t for t in tasks}
    assert by_title["Clinical Research"]["description"] == ""

    warnings = find_warnings(graph)
    empty_warning = next(w for w in warnings if w.code == "empty_instruction")
    assert empty_warning.node_ids == ["A", "B"]


def test_node_with_instruction_produces_no_empty_instruction_warning() -> None:
    nodes = [_node("A"), _node("B")]
    edges = [_edge("A", "B")]
    warnings = find_warnings(_graph(nodes, edges))
    assert all(w.code != "empty_instruction" for w in warnings)


# =============================================================================
# REST routes — app/routes/workflows.py (chunk 4)
# =============================================================================


def _client(token: str | None = None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return RawAsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=headers)


async def _make_user(email: str) -> uuid.UUID:
    async with SessionLocal() as session:
        user = User(email=email.strip().lower())
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user.id


async def _make_agent(user_id: uuid.UUID | None, slug: str) -> uuid.UUID:
    """A minimal Agent row so compile_workflow's valid_slugs check has
    something real to accept. user_id=None means legacy-null (visible to
    everyone, same as runs/workflows); pass a real user_id for the
    private-agent security test."""
    async with SessionLocal() as session:
        agent = Agent(
            slug=slug,
            name=slug,
            description="",
            system_prompt="You are terse.",
            model="test-model",
            tools=[],
            user_id=user_id,
        )
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
        return agent.id


def _wf_node(
    node_id: str,
    *,
    agent_slug: str,
    title: str | None = None,
    instruction: str | None = None,
) -> dict:
    return {
        "id": node_id,
        "agent_slug": agent_slug,
        "title": title or node_id,
        "instruction": f"do {node_id}" if instruction is None else instruction,
        "needs_approval": False,
    }


def _wf_edge(source: str, target: str) -> dict:
    return {"id": f"{source}-{target}", "source": source, "target": target}


def _wf_graph(nodes: list[dict], edges: list[dict]) -> dict:
    return {"schema_version": 1, "nodes": nodes, "edges": edges}


def _patch_dispatch(monkeypatch) -> list[uuid.UUID]:
    """Same pattern as test_run_tasks.py's _patch_dispatch: records calls
    instead of touching arq/Redis or the in-process orchestrator fallback."""
    calls: list[uuid.UUID] = []

    async def _fake_dispatch_execute(run_id: uuid.UUID) -> None:
        calls.append(run_id)

    monkeypatch.setattr("app.routes.workflows.dispatch_execute", _fake_dispatch_execute)
    return calls


async def _cleanup(
    *,
    workflow_ids: list[uuid.UUID] | None = None,
    run_ids: list[uuid.UUID] | None = None,
    agent_ids: list[uuid.UUID] | None = None,
    emails: list[str] | None = None,
) -> None:
    async with SessionLocal() as session:
        for rid in run_ids or []:
            run = await session.get(Run, rid)
            if run:
                await session.delete(run)  # cascades to run_tasks
        for wid in workflow_ids or []:
            wf = await session.get(Workflow, wid)
            if wf:
                await session.delete(wf)
        for aid in agent_ids or []:
            agent = await session.get(Agent, aid)
            if agent:
                await session.delete(agent)
        for email in emails or []:
            user = (
                await session.execute(select(User).where(User.email == email.strip().lower()))
            ).scalar_one_or_none()
            if user:
                await session.delete(user)
        await session.commit()
    await engine.dispose()


# --- CRUD --------------------------------------------------------------------


async def test_workflow_crud_roundtrip() -> None:
    await engine.dispose()
    email = f"wf-crud-{uuid.uuid4().hex[:8]}@agentfleet.test"
    await _make_user(email)
    workflow_id: uuid.UUID | None = None
    try:
        token = mint_token(email=email)
        async with _client(token) as client:
            create_res = await client.post(
                "/api/v1/workflows",
                json={
                    "name": "My Workflow",
                    "description": "A test workflow",
                    "graph": _wf_graph([], []),
                },
            )
            assert create_res.status_code == 201, create_res.text
            created = create_res.json()
            workflow_id = uuid.UUID(created["id"])
            assert created["name"] == "My Workflow"
            assert created["description"] == "A test workflow"
            assert created["node_count"] == 0
            assert created["edge_count"] == 0
            assert created["graph"]["nodes"] == []

            get_res = await client.get(f"/api/v1/workflows/{workflow_id}")
            assert get_res.status_code == 200, get_res.text
            assert get_res.json()["name"] == "My Workflow"

            put_res = await client.put(
                f"/api/v1/workflows/{workflow_id}",
                json={"name": "Renamed Workflow", "description": "Updated"},
            )
            assert put_res.status_code == 200, put_res.text
            updated = put_res.json()
            assert updated["name"] == "Renamed Workflow"
            assert updated["description"] == "Updated"

            delete_res = await client.delete(f"/api/v1/workflows/{workflow_id}")
            assert delete_res.status_code == 200, delete_res.text
            assert delete_res.json() == {"ok": True}

            gone_res = await client.get(f"/api/v1/workflows/{workflow_id}")
            assert gone_res.status_code == 404
        workflow_id = None  # already deleted via the API
    finally:
        await _cleanup(
            workflow_ids=[workflow_id] if workflow_id else [],
            emails=[email],
        )


async def test_workflow_list_pagination_and_total_count() -> None:
    await engine.dispose()
    email = f"wf-list-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_id = await _make_user(email)
    workflow_ids: list[uuid.UUID] = []
    try:
        # Explicit, strictly increasing updated_at (like test_pagination.py's
        # EvalRun rows) so ORDER BY updated_at DESC is unambiguous even when
        # all 5 rows are inserted faster than DB clock resolution.
        base = datetime(2025, 1, 1, tzinfo=timezone.utc)
        async with SessionLocal() as session:
            for i in range(5):
                wf = Workflow(
                    name=f"Workflow {i}",
                    description="",
                    graph=_wf_graph([], []),
                    user_id=user_id,
                    updated_at=base + timedelta(seconds=i),
                )
                session.add(wf)
                await session.flush()
                workflow_ids.append(wf.id)
            await session.commit()

        token = mint_token(email=email)
        async with _client(token) as client:
            res = await client.get("/api/v1/workflows", params={"limit": 2, "offset": 1})
            assert res.status_code == 200, res.text
            assert res.headers["X-Total-Count"] == "5"
            body = res.json()
            assert len(body) == 2
            # DESC by updated_at: Workflow 4, 3, 2, 1, 0 -> offset 1 skips
            # Workflow 4, so the page is [Workflow 3, Workflow 2].
            assert [w["name"] for w in body] == ["Workflow 3", "Workflow 2"]
    finally:
        await _cleanup(workflow_ids=workflow_ids, emails=[email])


async def test_workflow_of_another_user_is_404(monkeypatch) -> None:
    await engine.dispose()
    dispatch_calls = _patch_dispatch(monkeypatch)
    email_a = f"wf-owner-a-{uuid.uuid4().hex[:8]}@agentfleet.test"
    email_b = f"wf-owner-b-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_a_id = await _make_user(email_a)
    await _make_user(email_b)
    workflow_id: uuid.UUID | None = None
    try:
        async with SessionLocal() as session:
            wf = Workflow(
                name="Private WF", description="", graph=_wf_graph([], []), user_id=user_a_id
            )
            session.add(wf)
            await session.commit()
            await session.refresh(wf)
            workflow_id = wf.id

        token_b = mint_token(email=email_b)
        async with _client(token_b) as client:
            assert (await client.get(f"/api/v1/workflows/{workflow_id}")).status_code == 404
            assert (
                await client.put(f"/api/v1/workflows/{workflow_id}", json={"name": "Hacked"})
            ).status_code == 404
            assert (
                await client.post(f"/api/v1/workflows/{workflow_id}/validate")
            ).status_code == 404
            assert (await client.post(f"/api/v1/workflows/{workflow_id}/run")).status_code == 404
            # DELETE last so the earlier assertions still have a row to 404 against.
            assert (await client.delete(f"/api/v1/workflows/{workflow_id}")).status_code == 404

        assert dispatch_calls == []
    finally:
        await _cleanup(
            workflow_ids=[workflow_id] if workflow_id else [], emails=[email_a, email_b]
        )


# --- /validate -----------------------------------------------------------------


async def test_validate_reports_cycle_without_writing(monkeypatch) -> None:
    await engine.dispose()
    dispatch_calls = _patch_dispatch(monkeypatch)
    email = f"wf-cycle-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_id = await _make_user(email)
    agent_slug = f"wf-agent-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(user_id, agent_slug)
    workflow_id: uuid.UUID | None = None
    try:
        graph = _wf_graph(
            [_wf_node("A", agent_slug=agent_slug), _wf_node("B", agent_slug=agent_slug)],
            [_wf_edge("A", "B"), _wf_edge("B", "A")],
        )
        async with SessionLocal() as session:
            wf = Workflow(name="Cyclic", description="", graph=graph, user_id=user_id)
            session.add(wf)
            await session.commit()
            await session.refresh(wf)
            workflow_id = wf.id

        async with SessionLocal() as session:
            runs_before = (
                await session.execute(select(func.count()).select_from(Run))
            ).scalar_one()
            tasks_before = (
                await session.execute(select(func.count()).select_from(RunTask))
            ).scalar_one()

        token = mint_token(email=email)
        async with _client(token) as client:
            res = await client.post(f"/api/v1/workflows/{workflow_id}/validate")
            assert res.status_code == 200, res.text
            body = res.json()
            assert body["ok"] is False
            assert len(body["errors"]) == 1
            assert body["errors"][0]["code"] == "cycle"
            assert body["tasks"] == []
            assert body["estimated_waves"] == 0

        async with SessionLocal() as session:
            runs_after = (
                await session.execute(select(func.count()).select_from(Run))
            ).scalar_one()
            tasks_after = (
                await session.execute(select(func.count()).select_from(RunTask))
            ).scalar_one()
        assert runs_after == runs_before
        assert tasks_after == tasks_before
        assert dispatch_calls == []
    finally:
        await _cleanup(
            workflow_ids=[workflow_id] if workflow_id else [],
            agent_ids=[agent_id],
            emails=[email],
        )


async def test_validate_reports_orphan_warning() -> None:
    await engine.dispose()
    email = f"wf-orphan-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_id = await _make_user(email)
    agent_slug = f"wf-agent-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(user_id, agent_slug)
    workflow_id: uuid.UUID | None = None
    try:
        graph = _wf_graph(
            [
                _wf_node("A", agent_slug=agent_slug),
                _wf_node("B", agent_slug=agent_slug),
                _wf_node("ORPHAN", agent_slug=agent_slug),
            ],
            [_wf_edge("A", "B")],
        )
        async with SessionLocal() as session:
            wf = Workflow(name="Has Orphan", description="", graph=graph, user_id=user_id)
            session.add(wf)
            await session.commit()
            await session.refresh(wf)
            workflow_id = wf.id

        token = mint_token(email=email)
        async with _client(token) as client:
            res = await client.post(f"/api/v1/workflows/{workflow_id}/validate")
            assert res.status_code == 200, res.text
            body = res.json()
            assert body["ok"] is True
            assert body["errors"] == []
            codes = {w["code"] for w in body["warnings"]}
            assert "orphan_node" in codes
            assert len(body["tasks"]) == 3
    finally:
        await _cleanup(
            workflow_ids=[workflow_id] if workflow_id else [],
            agent_ids=[agent_id],
            emails=[email],
        )


async def test_validate_reports_empty_instruction_warning() -> None:
    await engine.dispose()
    email = f"wf-empty-instr-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_id = await _make_user(email)
    agent_slug = f"wf-agent-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(user_id, agent_slug)
    workflow_id: uuid.UUID | None = None
    try:
        graph = _wf_graph(
            [
                _wf_node("A", agent_slug=agent_slug, instruction=""),
                _wf_node("B", agent_slug=agent_slug),
            ],
            [_wf_edge("A", "B")],
        )
        async with SessionLocal() as session:
            wf = Workflow(name="Blank Instruction", description="", graph=graph, user_id=user_id)
            session.add(wf)
            await session.commit()
            await session.refresh(wf)
            workflow_id = wf.id

        token = mint_token(email=email)
        async with _client(token) as client:
            res = await client.post(f"/api/v1/workflows/{workflow_id}/validate")
            assert res.status_code == 200, res.text
            body = res.json()
            assert body["ok"] is True
            assert body["errors"] == []
            warning = next(w for w in body["warnings"] if w["code"] == "empty_instruction")
            assert warning["node_ids"] == ["A"]
            assert len(body["tasks"]) == 2
    finally:
        await _cleanup(
            workflow_ids=[workflow_id] if workflow_id else [],
            agent_ids=[agent_id],
            emails=[email],
        )


# --- /run ----------------------------------------------------------------------


async def test_run_workflow_creates_run_and_tasks_and_dispatches(monkeypatch) -> None:
    await engine.dispose()
    dispatch_calls = _patch_dispatch(monkeypatch)
    email = f"wf-run-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_id = await _make_user(email)
    agent_slug = f"wf-agent-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(user_id, agent_slug)
    workflow_id: uuid.UUID | None = None
    run_id: uuid.UUID | None = None
    try:
        # Linear chain A -> B -> C, all on the same agent.
        graph = _wf_graph(
            [
                _wf_node("A", agent_slug=agent_slug),
                _wf_node("B", agent_slug=agent_slug),
                _wf_node("C", agent_slug=agent_slug),
            ],
            [_wf_edge("A", "B"), _wf_edge("B", "C")],
        )
        async with SessionLocal() as session:
            wf = Workflow(name="Chain", description="", graph=graph, user_id=user_id)
            session.add(wf)
            await session.commit()
            await session.refresh(wf)
            workflow_id = wf.id

        token = mint_token(email=email)
        async with _client(token) as client:
            res = await client.post(f"/api/v1/workflows/{workflow_id}/run")
            assert res.status_code == 201, res.text
            body = res.json()
            assert body["task_count"] == 3
            run_id = uuid.UUID(body["run_id"])

        async with SessionLocal() as session:
            run = await session.get(Run, run_id)
            assert run.status == "running"
            assert run.workflow_id == workflow_id

            tasks = (
                (
                    await session.execute(
                        select(RunTask).where(RunTask.run_id == run_id).order_by(RunTask.ordinal)
                    )
                )
                .scalars()
                .all()
            )
            assert len(tasks) == 3
            assert [t.ordinal for t in tasks] == [0, 1, 2]
            assert [t.depends_on for t in tasks] == [[], [0], [1]]
            assert all(t.agent_slug == agent_slug for t in tasks)

        assert dispatch_calls == [run_id]
    finally:
        await _cleanup(
            workflow_ids=[workflow_id] if workflow_id else [],
            run_ids=[run_id] if run_id else [],
            agent_ids=[agent_id],
            emails=[email],
        )


async def test_run_workflow_with_empty_instruction_still_runs(monkeypatch) -> None:
    # empty_instruction is a WARNING, never an error — a half-finished graph
    # must stay runnable. /run doesn't even call find_warnings, but assert
    # the observable behavior directly: this graph runs exactly like any
    # other, warning or not.
    await engine.dispose()
    dispatch_calls = _patch_dispatch(monkeypatch)
    email = f"wf-run-empty-instr-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_id = await _make_user(email)
    agent_slug = f"wf-agent-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(user_id, agent_slug)
    workflow_id: uuid.UUID | None = None
    run_id: uuid.UUID | None = None
    try:
        graph = _wf_graph(
            [
                _wf_node("A", agent_slug=agent_slug, instruction="   "),
                _wf_node("B", agent_slug=agent_slug),
            ],
            [_wf_edge("A", "B")],
        )
        async with SessionLocal() as session:
            wf = Workflow(name="Blank Instr Run", description="", graph=graph, user_id=user_id)
            session.add(wf)
            await session.commit()
            await session.refresh(wf)
            workflow_id = wf.id

        token = mint_token(email=email)
        async with _client(token) as client:
            res = await client.post(f"/api/v1/workflows/{workflow_id}/run")
            assert res.status_code == 201, res.text
            body = res.json()
            assert body["task_count"] == 2
            run_id = uuid.UUID(body["run_id"])

        async with SessionLocal() as session:
            run = await session.get(Run, run_id)
            assert run.status == "running"

        assert dispatch_calls == [run_id]
    finally:
        await _cleanup(
            workflow_ids=[workflow_id] if workflow_id else [],
            run_ids=[run_id] if run_id else [],
            agent_ids=[agent_id],
            emails=[email],
        )


async def test_run_workflow_with_cycle_is_422(monkeypatch) -> None:
    await engine.dispose()
    dispatch_calls = _patch_dispatch(monkeypatch)
    email = f"wf-run-cycle-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_id = await _make_user(email)
    agent_slug = f"wf-agent-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(user_id, agent_slug)
    workflow_id: uuid.UUID | None = None
    try:
        graph = _wf_graph(
            [_wf_node("A", agent_slug=agent_slug), _wf_node("B", agent_slug=agent_slug)],
            [_wf_edge("A", "B"), _wf_edge("B", "A")],
        )
        async with SessionLocal() as session:
            wf = Workflow(name="Cyclic", description="", graph=graph, user_id=user_id)
            session.add(wf)
            await session.commit()
            await session.refresh(wf)
            workflow_id = wf.id

        async with SessionLocal() as session:
            runs_before = (
                await session.execute(select(func.count()).select_from(Run))
            ).scalar_one()

        token = mint_token(email=email)
        async with _client(token) as client:
            res = await client.post(f"/api/v1/workflows/{workflow_id}/run")
            assert res.status_code == 422, res.text

        async with SessionLocal() as session:
            runs_after = (
                await session.execute(select(func.count()).select_from(Run))
            ).scalar_one()
        assert runs_after == runs_before
        assert dispatch_calls == []
    finally:
        await _cleanup(
            workflow_ids=[workflow_id] if workflow_id else [],
            agent_ids=[agent_id],
            emails=[email],
        )


async def test_run_workflow_rejects_agent_slug_not_visible_to_caller(monkeypatch) -> None:
    """Security test: user A's workflow references a node with user B's
    PRIVATE agent slug. valid_slugs must be scoped to the caller (A), so
    the run must be rejected as unknown_agent — never silently allowed to
    execute user B's private agent config."""
    await engine.dispose()
    dispatch_calls = _patch_dispatch(monkeypatch)
    email_a = f"wf-sec-a-{uuid.uuid4().hex[:8]}@agentfleet.test"
    email_b = f"wf-sec-b-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_a_id = await _make_user(email_a)
    user_b_id = await _make_user(email_b)
    private_slug = f"wf-private-agent-{uuid.uuid4().hex[:8]}"
    private_agent_id = await _make_agent(user_b_id, private_slug)
    workflow_id: uuid.UUID | None = None
    try:
        graph = _wf_graph([_wf_node("A", agent_slug=private_slug)], [])
        async with SessionLocal() as session:
            wf = Workflow(
                name="Sneaky", description="", graph=graph, user_id=user_a_id
            )
            session.add(wf)
            await session.commit()
            await session.refresh(wf)
            workflow_id = wf.id

        async with SessionLocal() as session:
            runs_before = (
                await session.execute(select(func.count()).select_from(Run))
            ).scalar_one()

        token_a = mint_token(email=email_a)
        async with _client(token_a) as client:
            res = await client.post(f"/api/v1/workflows/{workflow_id}/run")
            assert res.status_code == 422, res.text
            assert "Unknown agent slug" in res.json()["detail"]
            assert private_slug in res.json()["detail"]

        async with SessionLocal() as session:
            runs_after = (
                await session.execute(select(func.count()).select_from(Run))
            ).scalar_one()
        assert runs_after == runs_before
        assert dispatch_calls == []
    finally:
        await _cleanup(
            workflow_ids=[workflow_id] if workflow_id else [],
            agent_ids=[private_agent_id],
            emails=[email_a, email_b],
        )


# --- PUT leniency ----------------------------------------------------------------


async def test_put_accepts_semantically_invalid_graph() -> None:
    """PUT must accept a graph that's structurally valid (per Pydantic) but
    semantically broken (a cycle referencing an agent slug that doesn't even
    exist) — a builder that refuses to save work-in-progress is hostile.
    compile_workflow is never called from PUT."""
    await engine.dispose()
    email = f"wf-lenient-{uuid.uuid4().hex[:8]}@agentfleet.test"
    await _make_user(email)
    workflow_id: uuid.UUID | None = None
    try:
        token = mint_token(email=email)
        async with _client(token) as client:
            create_res = await client.post(
                "/api/v1/workflows",
                json={"name": "WIP", "description": "", "graph": _wf_graph([], [])},
            )
            assert create_res.status_code == 201, create_res.text
            workflow_id = uuid.UUID(create_res.json()["id"])

            broken_graph = _wf_graph(
                [
                    _wf_node("A", agent_slug="totally-fake-agent-does-not-exist"),
                    _wf_node("B", agent_slug="totally-fake-agent-does-not-exist"),
                ],
                [_wf_edge("A", "B"), _wf_edge("B", "A")],
            )
            put_res = await client.put(
                f"/api/v1/workflows/{workflow_id}", json={"graph": broken_graph}
            )
            assert put_res.status_code == 200, put_res.text
            body = put_res.json()
            assert body["node_count"] == 2
            assert body["edge_count"] == 2
            assert body["graph"]["edges"] == broken_graph["edges"]
    finally:
        await _cleanup(workflow_ids=[workflow_id] if workflow_id else [], emails=[email])
