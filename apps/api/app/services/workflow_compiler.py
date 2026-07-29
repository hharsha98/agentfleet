"""Compiles a human-authored Workflow graph (WorkflowGraphIn — nodes + edges
from the canvas builder) into the exact task-list shape
app.services.orchestrator.execute_run already knows how to drive: a list of
dicts, one per RunTask, with integer `depends_on` ordinals into that same
list.

CONTRAST WITH orchestrator.parse_plan: parse_plan degrades LLM output
gracefully — an LLM that emits a bad agent slug or an out-of-range dependency
gets silently coerced/dropped, because retrying the whole plan is expensive
and the model can't be told to "fix it". This compiler processes a
HUMAN-DRAWN graph instead: a bad edge or a typo'd agent slug is a mistake the
author can see and correct on the canvas, so every problem here is a hard
error (WorkflowValidationError) — never a silent coercion to "orchestrator".

CONTAINMENT: this module intentionally does NOT import
orchestrator.MAX_PLAN_TASKS. That cap bounds how many tasks the LLM planner
may propose in a single planning call; a hand-authored graph has nothing to
do with LLM planning and is capped independently, via MAX_WORKFLOW_NODES
enforced by Pydantic on WorkflowGraphIn itself.
"""

import heapq
from collections import defaultdict

from app.schemas import WorkflowGraphIn, WorkflowIssue, WorkflowNodeIn

# orchestrator._execute_task truncates each upstream task's result to 3000
# chars before splicing it into a downstream prompt. Below this many
# predecessors it's a non-issue; at/above it, later predecessors' output is
# effectively crowded out of the prompt — worth a warning, not a rejection.
WIDE_FAN_IN_THRESHOLD = 4


class WorkflowValidationError(Exception):
    """Raised by compile_workflow() for any structurally invalid graph.
    Carries enough structure (code/message/node_ids) for a route layer to
    build a WorkflowIssue without re-deriving it."""

    def __init__(self, code: str, message: str, node_ids: list[str] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.node_ids = node_ids or []


def compile_workflow(graph: WorkflowGraphIn, valid_slugs: set[str]) -> list[dict]:
    """Validate and topologically order a graph into RunTask-shaped dicts.

    Raises WorkflowValidationError (see codes below) on any structural
    problem. On success, returns tasks ordered so that for every task,
    every value in `depends_on` satisfies `0 <= d < ordinal` — see the
    INVARIANT comment below for why that's guaranteed, not just observed.
    """
    nodes = graph.nodes

    # duplicate_id — checked first: every later check indexes nodes by id,
    # so a duplicate id would make those lookups ambiguous.
    seen_ids: set[str] = set()
    dupe_ids: set[str] = set()
    for n in nodes:
        if n.id in seen_ids:
            dupe_ids.add(n.id)
        seen_ids.add(n.id)
    if dupe_ids:
        ids = sorted(dupe_ids)
        raise WorkflowValidationError(
            "duplicate_id", f"Duplicate node id(s): {', '.join(ids)}", ids
        )

    # empty
    if not nodes:
        raise WorkflowValidationError("empty", "Workflow has no nodes.")

    node_by_id: dict[str, WorkflowNodeIn] = {n.id: n for n in nodes}
    order_index = {n.id: i for i, n in enumerate(nodes)}  # author declaration order

    # self_loop — React Flow's canvas permits dragging an edge from a node
    # back to itself; the compiler must not (it would make the node
    # depend on its own output).
    self_loop_ids = sorted({e.source for e in graph.edges if e.source == e.target})
    if self_loop_ids:
        raise WorkflowValidationError(
            "self_loop", f"Self-loop edge(s) on node(s): {', '.join(self_loop_ids)}", self_loop_ids
        )

    # dangling_edge — an edge endpoint that isn't any node's id.
    dangling_ids = sorted(
        {nid for e in graph.edges for nid in (e.source, e.target) if nid not in node_by_id}
    )
    if dangling_ids:
        raise WorkflowValidationError(
            "dangling_edge",
            f"Edge references unknown node id(s): {', '.join(dangling_ids)}",
            dangling_ids,
        )

    # unknown_agent — HARD ERROR, deliberately. See module docstring: a human
    # who typed/selected a bad agent slug must be told, not silently routed
    # to "orchestrator" the way parse_plan routes bad LLM output.
    bad_nodes = sorted(n.id for n in nodes if n.agent_slug not in valid_slugs)
    if bad_nodes:
        bad_slugs = sorted({node_by_id[nid].agent_slug for nid in bad_nodes})
        raise WorkflowValidationError(
            "unknown_agent",
            f"Unknown agent slug(s) {', '.join(bad_slugs)} on node(s): {', '.join(bad_nodes)}",
            bad_nodes,
        )

    # Silently dedupe duplicate (source, target) pairs — a double-drag on the
    # canvas is a UI slip, not something the author needs to be told about.
    edge_pairs: set[tuple[str, str]] = {(e.source, e.target) for e in graph.edges}

    predecessors: dict[str, set[str]] = defaultdict(set)
    successors: dict[str, set[str]] = defaultdict(set)
    for source, target in edge_pairs:
        predecessors[target].add(source)
        successors[source].add(target)

    # Kahn's algorithm with a DETERMINISTIC tie-break: among all currently-
    # ready nodes, always pop the one with the smallest author-declaration
    # index (order_index). A min-heap keyed on that index is both correct
    # and cheap. Determinism means compiling the same graph twice yields
    # byte-identical output, and re-saving an unchanged graph never churns
    # ordinals.
    indegree = {n.id: len(predecessors[n.id]) for n in nodes}
    idx_to_id = {order_index[n.id]: n.id for n in nodes}
    heap = [order_index[n.id] for n in nodes if indegree[n.id] == 0]
    heapq.heapify(heap)

    topo_order: list[str] = []
    while heap:
        nid = idx_to_id[heapq.heappop(heap)]
        topo_order.append(nid)
        for succ in successors[nid]:
            indegree[succ] -= 1
            if indegree[succ] == 0:
                heapq.heappush(heap, order_index[succ])

    if len(topo_order) < len(nodes):
        # cycle — whatever never reached indegree 0 is exactly the cycle
        # (plus anything only reachable through it).
        remaining = sorted(
            (nid for nid in node_by_id if nid not in topo_order), key=order_index.get
        )
        named = ", ".join(f"{node_by_id[nid].title!r} ({nid})" for nid in remaining)
        raise WorkflowValidationError("cycle", f"Cycle detected among node(s): {named}", remaining)

    # INVARIANT: Kahn's algorithm never pops a node until every one of its
    # predecessors has already been popped (that's what "indegree reaches
    # zero" means). So for every edge pred -> succ, pred is popped — and
    # therefore assigned its `pos` — strictly before succ. Consequently,
    # for every task at list index i, every entry d in its depends_on
    # satisfies 0 <= d < i. That is exactly the shape execute_run assumes
    # when it computes `set(t.depends_on or []) <= done`.
    pos = {nid: i for i, nid in enumerate(topo_order)}
    tasks: list[dict] = []
    for i, nid in enumerate(topo_order):
        node = node_by_id[nid]
        tasks.append(
            {
                "ordinal": i,
                "title": node.title,
                "description": node.instruction,
                "agent_slug": node.agent_slug,
                "depends_on": sorted(pos[p] for p in predecessors[nid]),
                "needs_approval": node.needs_approval,
            }
        )
    return tasks


def estimated_waves(tasks: list[dict]) -> int:
    """Longest-path depth + 1 — the number of execute_run while-loop
    iterations a compiled workflow takes to finish (approval pauses aside).

    Assumes `tasks` is compile_workflow's output: list index == ordinal, and
    every depends_on value is a smaller ordinal, so a single forward pass
    (processing tasks in list order) always sees each dependency's depth
    already computed.
    """
    if not tasks:
        return 0
    depth = [0] * len(tasks)
    for t in tasks:
        i = t["ordinal"]
        for d in t["depends_on"]:
            depth[i] = max(depth[i], depth[d] + 1)
    return max(depth) + 1


def find_warnings(graph: WorkflowGraphIn) -> list[WorkflowIssue]:
    """Non-fatal issues for dry-run validation. Assumes `graph` already
    passed compile_workflow's hard-error checks (called separately) — this
    only flags things that are legal but worth a human's attention:

    - orphan_node: a node with no edges at all. Legal — it simply runs in
      the first wave alongside every other node with no dependencies — but
      likely means the author forgot to wire it up.
    - wide_fan_in: a node with >= WIDE_FAN_IN_THRESHOLD predecessors. Legal,
      but orchestrator._execute_task truncates each upstream result to 3000
      chars, so with this many predecessors some of their output is
      effectively invisible to the downstream agent.
    - empty_instruction: a node whose instruction is empty/whitespace-only.
      Legal — compile_workflow happily emits `description: ""` for it — but
      the compiled task's brief then falls back to just the title, so the
      agent receives something like "Clinical Research" with no actual ask
      and typically responds by asking the user for clarification instead of
      doing the work. Purely a per-node check, independent of edges/order,
      so it's computed straight from graph.nodes.
    """
    order_index = {n.id: i for i, n in enumerate(graph.nodes)}
    edge_pairs: set[tuple[str, str]] = {(e.source, e.target) for e in graph.edges}

    touched: set[str] = set()
    indegree: dict[str, int] = defaultdict(int)
    for source, target in edge_pairs:
        touched.add(source)
        touched.add(target)
        indegree[target] += 1

    warnings: list[WorkflowIssue] = []

    orphans = sorted((n.id for n in graph.nodes if n.id not in touched), key=order_index.get)
    if orphans:
        warnings.append(
            WorkflowIssue(
                code="orphan_node",
                message="Node(s) with no edges at all — they run in the first wave: "
                + ", ".join(orphans),
                node_ids=orphans,
            )
        )

    wide_fan_in = sorted(
        (nid for nid, count in indegree.items() if count >= WIDE_FAN_IN_THRESHOLD),
        key=order_index.get,
    )
    if wide_fan_in:
        warnings.append(
            WorkflowIssue(
                code="wide_fan_in",
                message=(
                    f"Node(s) with {WIDE_FAN_IN_THRESHOLD}+ predecessors — orchestrator truncates "
                    "each upstream result to 3000 chars, so some predecessors' output may be "
                    "crowded out: " + ", ".join(wide_fan_in)
                ),
                node_ids=wide_fan_in,
            )
        )

    # empty_instruction — a per-node check over graph.nodes directly, so
    # (unlike orphan_node/wide_fan_in above) it doesn't touch edges/indegree
    # at all and can't be affected by dangling edges either way.
    empty_instruction = sorted(
        (n.id for n in graph.nodes if not n.instruction.strip()),
        key=order_index.get,
    )
    if empty_instruction:
        warnings.append(
            WorkflowIssue(
                code="empty_instruction",
                message=(
                    "Node(s) with no instruction — the agent only receives the node's title, "
                    "so it may just ask for clarification instead of doing the work: "
                    + ", ".join(empty_instruction)
                ),
                node_ids=empty_instruction,
            )
        )

    return warnings
