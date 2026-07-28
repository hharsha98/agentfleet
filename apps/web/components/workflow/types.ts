// Shared TS types for the workflow graph view (components/workflow/*).
//
// `Task` is the canonical shape of one task on a run — moved here from
// missions/page.tsx (which now imports it back) so layout.ts, nodes.tsx,
// and flow-canvas.tsx all agree on the exact same shape the board already
// uses, with no risk of the two silently drifting apart.
import type { Edge, Node } from "@xyflow/react";

export type TaskStatus = "todo" | "in_progress" | "review" | "done" | "failed";

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
  tokens_in: number;
  tokens_out: number;
  latency_ms: number | null;
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
};

export type BuilderFlowNode = Node<BuilderNodeData, "builder">;
export type BuilderFlowEdge = Edge;
