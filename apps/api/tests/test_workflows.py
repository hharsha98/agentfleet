"""Tests for app/services/workflow_compiler.py — the DAG compiler that turns
a human-authored Workflow graph into RunTask-shaped dicts.

Fully hermetic, like test_orchestrator.py: pure functions over Pydantic
objects, no DB, no HTTP, no LLM. compile_workflow/estimated_waves/
find_warnings never touch the database or the network, so these tests build
WorkflowGraphIn objects directly and assert on the returned dicts/exceptions.
"""

import pytest

from app.schemas import WorkflowEdgeIn, WorkflowGraphIn, WorkflowNodeIn
from app.services.workflow_compiler import (
    WorkflowValidationError,
    compile_workflow,
    estimated_waves,
    find_warnings,
)

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
