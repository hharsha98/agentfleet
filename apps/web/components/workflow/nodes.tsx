"use client";

import type { CSSProperties, ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { AGENT_VISUALS, AgentGlyph, hueForSlug } from "@/components/agent-visual";
import { HUE_CLASSES, type Hue } from "@/components/landing/icons";

import { agentDisplayName } from "./format";
import { NODE_H, NODE_W } from "./layout";
import type { BuilderFlowNode, Task, TaskFlowNode } from "./types";

// Mirrors COLUMNS in missions/page.tsx — the board and this graph must never
// disagree about what color a status is. If COLUMNS changes, update this too.
const STATUS_HUE: Record<Task["status"], Hue> = {
  todo: "blue",
  in_progress: "violet",
  review: "amber",
  done: "green",
  failed: "red",
};

const STATUS_LABEL: Record<Task["status"], string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "Needs approval",
  done: "Done",
  failed: "Failed",
};

const HUE_DOT: Record<Hue, string> = {
  blue: "bg-hue-blue",
  violet: "bg-hue-violet",
  cyan: "bg-hue-cyan",
  amber: "bg-hue-amber",
  green: "bg-hue-green",
  red: "bg-hue-red",
};

// Tailwind's JIT scanner needs complete literal class names in source, so
// this hue->ring map (like HUE_DOT above) can't be built with a template
// string at render time.
const HUE_RING: Record<Hue, string> = {
  blue: "ring-hue-blue/40",
  violet: "ring-hue-violet/40",
  cyan: "ring-hue-cyan/40",
  amber: "ring-hue-amber/40",
  green: "ring-hue-green/40",
  red: "ring-hue-red/40",
};

// .react-flow__handle ships its own rules in style.css, loaded after
// globals.css at equal specificity — a Tailwind class here would lose that
// source-order tiebreak. Inline style always wins regardless of order.
const handleStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 9999,
  background: "var(--accent)",
  border: "1px solid var(--background)",
};

// Shared shell every workflow node type renders inside — keeps graph nodes
// visually identical to the board's TaskCard (rounded-md, hairline border,
// bg-background) instead of React Flow's default boxes, plus a hue ring
// carrying the status color the board conveys via column position instead.
export function NodeShell({
  hue,
  glyph,
  title,
  agentName,
  meta,
  invalid = false,
  selected = false,
  children,
}: {
  hue: Hue;
  glyph: ReactNode;
  title: string;
  agentName: string;
  meta: ReactNode;
  invalid?: boolean;
  // Builder-only: the run DAG (TaskNode) never passes this, so it always
  // defaults to false there and the ring falls through to HUE_RING exactly
  // as before this prop was added.
  selected?: boolean;
  children?: ReactNode;
}) {
  const c = HUE_CLASSES[hue];
  const ringClass = invalid ? "ring-2 ring-red-500/60" : selected ? "ring-2 ring-accent" : HUE_RING[hue];
  return (
    <div
      style={{ width: NODE_W, minHeight: NODE_H }}
      className={`relative rounded-md border border-hairline bg-background p-2.5 text-sm ring-1 ${ringClass}`}
      title={invalid ? "Depends on a task not shown in this run" : undefined}
    >
      <p className="truncate leading-snug">{title}</p>

      <span className="mt-1.5 flex w-fit items-center gap-1 rounded-full border border-hairline bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-muted">
        {glyph}
        {agentName}
      </span>

      <span className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] text-muted">
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${HUE_DOT[hue]}`} />
        <span className={c.icon}>{meta}</span>
      </span>

      {children}
    </div>
  );
}

export function TaskNode({ data }: NodeProps<TaskFlowNode>) {
  const { task, agentName, invalid } = data;
  const hue = STATUS_HUE[task.status];
  const hasMeta = task.tokens_in > 0 || task.tokens_out > 0;

  return (
    <NodeShell
      hue={hue}
      invalid={invalid}
      title={task.title}
      agentName={agentName}
      glyph={<AgentGlyph slug={task.agent_slug} name={agentName} size="xs" />}
      meta={
        hasMeta ? (
          // Byte-identical format to missions/page.tsx:217's meta line.
          <>
            {STATUS_LABEL[task.status]} · ↑{task.tokens_in} ↓{task.tokens_out} tok
            {task.latency_ms != null && ` · ${task.latency_ms}ms`}
          </>
        ) : (
          STATUS_LABEL[task.status]
        )
      }
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </NodeShell>
  );
}

// Builder node — same NodeShell chrome as the run DAG's TaskNode above, but
// backed by a draft BuilderNodeData instead of a run Task (no status, no
// tokens: nothing has executed yet). Hue comes from the agent itself
// (AGENT_VISUALS / hueForSlug, the same source AgentGlyph uses) rather than
// a run status, since a builder node has no status to color by.
export function BuilderNode({ data, selected }: NodeProps<BuilderFlowNode>) {
  const hue = AGENT_VISUALS[data.agentSlug]?.hue ?? hueForSlug(data.agentSlug);
  const agentName = agentDisplayName(data.agentSlug);

  return (
    <NodeShell
      hue={hue}
      selected={selected}
      title={data.title || "Untitled step"}
      agentName={agentName}
      glyph={<AgentGlyph slug={data.agentSlug} name={agentName} size="xs" />}
      meta={data.needsApproval ? "Needs approval" : "Runs automatically"}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </NodeShell>
  );
}
