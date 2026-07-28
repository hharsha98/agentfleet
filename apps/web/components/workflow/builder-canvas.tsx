"use client";

// Component-scoped CSS import (not in globals.css) — this keeps React
// Flow's stylesheet out of every route's bundle; it only ships on the
// pages that actually render <BuilderCanvas/>, and only inside the lazy
// chunk next/dynamic(ssr:false) splits it into from workflow-builder.tsx
// (see node_modules/next/dist/docs/01-app/01-getting-started/11-css.md
// "External stylesheets": importable anywhere in the app directory,
// including colocated client components — same idiom as flow-canvas.tsx).
import "@xyflow/react/dist/style.css";

import type { CSSProperties } from "react";
import { useMemo } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";

import { BuilderNode } from "./nodes";
import type { BuilderFlowEdge, BuilderFlowNode } from "./types";

// Module-level constant, NOT defined inline in the component below — React
// Flow re-creates every node whenever the `nodeTypes` object's identity
// changes (same rule flow-canvas.tsx follows for its own nodeTypes).
const nodeTypes = { builder: BuilderNode };

// Duplicated from flow-canvas.tsx rather than imported/shared: that file is
// explicitly off-limits for this chunk ("do NOT modify it and do NOT try
// to make it do double duty" — see PLAN), and it doesn't export this
// object. Real --xy-* variable names grepped from node_modules/@xyflow/
// react/dist/style.css, mapped onto this app's design tokens so the
// builder canvas's chrome reads as part of the same dark-first UI instead
// of React Flow's own defaults.
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

export type BuilderCanvasProps = {
  nodes: BuilderFlowNode[];
  edges: BuilderFlowEdge[];
  // Selection lives in the parent (workflow-builder.tsx needs it for the
  // Inspector too), so this component takes it as a prop and reports the
  // `selected` flag back onto each node purely for NodeShell's ring — it
  // is not React Flow's own internal selection state.
  selectedId: string | null;
  onNodesUpdate: (nodes: BuilderFlowNode[]) => void;
  onEdgesUpdate: (edges: BuilderFlowEdge[]) => void;
  onSelectNode: (id: string | null) => void;
};

export default function BuilderCanvas({
  nodes,
  edges,
  selectedId,
  onNodesUpdate,
  onEdgesUpdate,
  onSelectNode,
}: BuilderCanvasProps) {
  const displayNodes = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedId })),
    [nodes, selectedId],
  );

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable
      // Edges are created ONLY through the Inspector's "Connect to →"
      // select (see workflow-builder.tsx) — disabling connect-by-drag
      // keeps that one path authoritative instead of two ways to make an
      // edge that could disagree (e.g. a dragged connection skipping the
      // self-loop/duplicate checks the select applies).
      nodesConnectable={false}
      elementsSelectable
      // Deletion goes through the Inspector's "Delete node" / "Remove"
      // edge buttons only, which also clean up dangling edges — the
      // built-in Backspace/Delete key would remove a node via
      // applyNodeChanges without that cleanup, leaving orphaned edges.
      deleteKeyCode={null}
      onNodesChange={(changes: NodeChange<BuilderFlowNode>[]) =>
        onNodesUpdate(applyNodeChanges(changes, nodes))
      }
      onEdgesChange={(changes: EdgeChange<BuilderFlowEdge>[]) =>
        onEdgesUpdate(applyEdgeChanges(changes, edges))
      }
      onNodeClick={(_, node) => onSelectNode(node.id)}
      onPaneClick={() => onSelectNode(null)}
      // fitView only on mount (and via Controls' fit-view button) — never
      // on a data-change effect, which would yank the viewport out from
      // under the user every time they add or edit a node.
      onInit={(instance) => instance.fitView({ duration: 0 })}
      className="h-full w-full"
      style={flowThemeVars}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--hairline)" />
      <Controls />
    </ReactFlow>
  );
}
