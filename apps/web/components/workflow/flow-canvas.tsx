"use client";

// Component-scoped CSS import (not in globals.css) — this keeps React
// Flow's stylesheet out of every route's bundle; it only ships on the pages
// that actually render <FlowCanvas/> (see node_modules/next/dist/docs/01-app/
// 01-getting-started/11-css.md "External stylesheets": importable anywhere
// in the app directory, including colocated client components).
import "@xyflow/react/dist/style.css";

import type { CSSProperties } from "react";
import { useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";

import { agentDisplayName } from "./format";
import { layoutTasks } from "./layout";
import { TaskNode } from "./nodes";
import type { Task, TaskFlowEdge, TaskFlowNode } from "./types";

// Module-level constant, NOT defined inline in the component below — React
// Flow re-creates every node whenever the `nodeTypes` object's identity
// changes. missions/page.tsx polls every 3s; an inline object here would
// make every node flash/remount on every tick.
const nodeTypes = { task: TaskNode };

// Real --xy-* variable names (grepped from node_modules/@xyflow/react/dist/
// style.css) mapped onto this app's design tokens from app/globals.css, so
// the graph's chrome (edges, selection box, controls, attribution) reads as
// part of the same dark-first UI instead of React Flow's own defaults.
type FlowThemeVars = CSSProperties & Record<`--xy-${string}`, string>;
const flowThemeVars: FlowThemeVars = {
  "--xy-background-color": "transparent",
  "--xy-edge-stroke": "color-mix(in srgb, var(--muted) 55%, transparent)",
  "--xy-edge-stroke-selected": "var(--accent)",
  "--xy-connectionline-stroke": "var(--accent)",
  "--xy-selection-background-color": "color-mix(in srgb, var(--accent) 8%, transparent)",
  "--xy-selection-border": "1px dotted color-mix(in srgb, var(--accent) 60%, transparent)",
  "--xy-controls-button-background-color": "var(--background)",
  "--xy-controls-button-background-color-hover": "rgba(255, 255, 255, 0.06)",
  "--xy-controls-button-border-color": "var(--hairline)",
  "--xy-controls-button-color": "var(--muted)",
  "--xy-controls-button-color-hover": "var(--foreground)",
  "--xy-controls-box-shadow": "none",
  "--xy-attribution-background-color": "transparent",
};

function graphKeyFor(tasks: Task[]): string {
  return tasks
    .map(
      (t) =>
        `${t.ordinal}:${t.status}:${t.depends_on.join(",")}:${t.tokens_in}:${t.tokens_out}:${t.latency_ms}`,
    )
    .join("|");
}

export default function FlowCanvas({ tasks }: { tasks: Task[] }) {
  const graphKey = graphKeyFor(tasks);

  const { laidOutNodes, laidOutEdges } = useMemo(() => {
    const positions = layoutTasks(tasks);
    const posById = new Map(positions.map((p) => [p.id, p]));
    const ordinalToId = new Map(tasks.map((t) => [t.ordinal, t.id]));
    const ordinalSet = new Set(tasks.map((t) => t.ordinal));

    const nextNodes: TaskFlowNode[] = tasks.map((t) => {
      const pos = posById.get(t.id);
      return {
        id: t.id,
        type: "task",
        position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
        data: {
          task: t,
          agentName: agentDisplayName(t.agent_slug),
          invalid: t.depends_on.some((d) => !ordinalSet.has(d)),
        },
      };
    });

    const nextEdges: TaskFlowEdge[] = [];
    for (const t of tasks) {
      for (const dep of t.depends_on) {
        const sourceId = ordinalToId.get(dep);
        if (!sourceId) continue;
        const active = t.status === "in_progress";
        nextEdges.push({
          id: `e-${sourceId}-${t.id}`,
          source: sourceId,
          target: t.id,
          // Animated only when the TARGET task is in_progress — this is
          // information (work is actively flowing into that task), not
          // decoration.
          animated: active,
          style: active ? { stroke: "var(--accent)", strokeWidth: 2 } : undefined,
        });
      }
    }

    return { laidOutNodes: nextNodes, laidOutEdges: nextEdges };
    // Deliberately keyed on `graphKey` (the fields that actually affect
    // layout/rendering), not `tasks` itself. missions/page.tsx's 3s poll
    // gives `tasks` a new array reference every tick; relaying out on every
    // tick would fight the user's pan/zoom for no visual reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey]);

  const [nodes, setNodes, onNodesChange] = useNodesState<TaskFlowNode>(laidOutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TaskFlowEdge>(laidOutEdges);

  // Sync freshly-laid-out nodes/edges in without resetting the user's
  // current selection. laidOutNodes/laidOutEdges only get new identities
  // when graphKey changes (see the memo above), so this effect — and the
  // selection merge — only runs on real data changes, never on every poll
  // tick that leaves the graph's shape unchanged.
  useEffect(() => {
    setNodes((prev) =>
      laidOutNodes.map((n) => ({
        ...n,
        selected: prev.find((p) => p.id === n.id)?.selected ?? false,
      })),
    );
    setEdges(laidOutEdges);
  }, [laidOutNodes, laidOutEdges, setNodes, setEdges]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      // fitView runs ONLY here, on mount, and from Controls' built-in
      // fit-view button (an explicit user click) — never from an effect
      // keyed on data, which would yank the viewport out from under the
      // user on every 3s poll. duration 0: no animation on initial mount.
      onInit={(instance) => instance.fitView({ duration: 0 })}
      className="h-full w-full"
      style={flowThemeVars}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--hairline)" />
      <Controls />
    </ReactFlow>
  );
}
