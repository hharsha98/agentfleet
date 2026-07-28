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
