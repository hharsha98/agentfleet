// Shared TS types for the workflow graph view (components/workflow/*).
//
// `Task` is the canonical shape of one task on a run — moved here from
// missions/page.tsx (which now imports it back) so layout.ts, nodes.tsx,
// and flow-canvas.tsx all agree on the exact same shape the board already
// uses, with no risk of the two silently drifting apart.
import type { Edge, Node } from "@xyflow/react";

// "skipped" (orchestrator self-heal) — a task whose dependency ultimately
// failed or was skipped itself, propagated transitively through the DAG. It
// never runs, so it carries no result/tokens (see Task fields below).
//
// "superseded" (Layer 3 re-planning, orchestrator's append-and-supersede) —
// the task got stuck and the orchestrator proposed a repair plan instead of
// just failing it: new task(s) were appended and this one was marked
// superseded, pointing at its replacement via `superseded_by`. This is NOT
// a failure — the replacement (or a chain of them) carries the work
// forward, and this task's own dependents wait for that chain to resolve
// rather than being skipped. Like "skipped", it never produces a result.
export type TaskStatus =
  | "todo"
  | "in_progress"
  | "review"
  | "done"
  | "failed"
  | "skipped"
  | "superseded";

export type Task = {
  id: string;
  ordinal: number;
  title: string;
  description: string;
  agent_slug: string;
  depends_on: number[];
  needs_approval: boolean;
  status: TaskStatus;
  result: string;
  error: string | null;
  // Set together with status="superseded" — the ORDINAL (not id) of the
  // RunTask that now carries this task's work forward. May itself point at
  // a superseded task (a chain, e.g. 3 -> 7 -> 9); null for every other
  // status. See apps/api/app/models.py's RunTask.superseded_by for the
  // full backend contract.
  superseded_by: number | null;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number | null;
  // Orchestrator self-heal (attempts always >= 1; a value > 1 means the
  // orchestrator diagnosed and retried before landing on the final status).
  attempts: number;
  heal_log: {
    attempt: number;
    error: string;
    diagnosis: string;
    resolved: boolean;
    // Pure classification of the failure (services/orchestrator.py's
    // classify_failure) — lets the board explain WHY a repair happened,
    // not just that it did.
    classification: "transient" | "approach" | "capability";
    // The model this attempt ran on (escalation ladder, Layer 2) — for a
    // `resolved: true` entry, the model that actually produced the fix.
    model: string;
  }[];
};

// Data payload carried by every task node in the graph.
export type TaskNodeData = {
  task: Task;
  agentName: string;
  // True when a dependency ordinal isn't present among the run's current
  // tasks (e.g. filtered out) — layout.ts defensively falls back to rank 0
  // for these instead of producing NaN, and the node renders a warning ring
  // so the fallback is visible rather than silently wrong.
  invalid: boolean;
};

export type TaskFlowNode = Node<TaskNodeData, "task">;
export type TaskFlowEdge = Edge;

// --- Builder-specific types (components/workflow/workflow-builder.tsx) ----
//
// The builder edits a DRAFT graph — there's no run yet, so BuilderNodeData
// carries the editable fields directly instead of wrapping a run `Task`
// like TaskNodeData does above. Field names are camelCase (React/TS
// convention) even though the wire format (WorkflowGraphIn on the API) uses
// snake_case (agent_slug, needs_approval) — workflow-builder.tsx is the one
// place that translates between the two.
export type BuilderNodeData = {
  agentSlug: string;
  title: string;
  instruction: string;
  needsApproval: boolean;
  // Set by workflow-builder.tsx from a validate response's error node_ids —
  // NodeShell paints the red ring off this flag. Never sent to the API:
  // toGraph() builds its own plain object per node and never reads this
  // field, so it can't leak into a save payload.
  invalid?: boolean;
  // The humanized sentence for the error that set `invalid` (see
  // lib/workflow-issues.ts). NodeShell shows it as the node's hover title.
  // Without it the builder inherited TaskNode's default tooltip, "Depends on
  // a task not shown in this run" — run-graph copy that is simply false in a
  // draft graph, where there is no run and the real cause is a loop, an
  // unknown agent slug, and so on.
  invalidReason?: string;
  // --- derived display-only fields ------------------------------------------
  // `wave` and `waveUnknown` are computed per render by builder-canvas.tsx
  // from layout.ts's builderWaveRanks() — they are NOT stored in the
  // builder's `nodes` state and, like `invalid` above, cannot reach a save
  // payload. Zero-based rank; the node renders it as `wave + 1`.
  wave?: number;
  // True when the graph has a loop, so no wave number means anything. The
  // node greys its wave label out rather than printing a misleading number.
  waveUnknown?: boolean;
};

export type BuilderFlowNode = Node<BuilderNodeData, "builder">;
export type BuilderFlowEdge = Edge;
