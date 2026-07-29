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
import { useMemo, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Connection,
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
  // Zero-based wave rank per node id, from layout.ts's builderWaveRanks().
  // Merged into each node's `data` for display here rather than stored in the
  // parent's `nodes` state, so a derived number can never end up in a save
  // payload. `waveUnknown` is true when the graph has a loop.
  waveByNodeId: Record<string, number>;
  waveUnknown: boolean;
  onNodesUpdate: (nodes: BuilderFlowNode[]) => void;
  onEdgesUpdate: (edges: BuilderFlowEdge[]) => void;
  onSelectNode: (id: string | null) => void;
  // Drag-to-connect. Deliberately NOT React Flow's own addEdge() helper —
  // this hands the pair back to the parent's addEdge(source, target), the one
  // function that owns the no-self-loop / no-duplicate / MAX_EDGES /
  // clearValidationResult guards for BOTH creation paths.
  onConnectNodes: (sourceId: string, targetId: string) => void;
  // The same guards as a pure predicate, so an illegal target can be refused
  // and greyed out mid-drag instead of failing silently on drop.
  canConnect: (sourceId: string, targetId: string) => boolean;
  // Keyboard deletion (Backspace/Delete) — routed to the parent so it does
  // the identical orphan-edge cleanup deleteNode()/deleteEdge() already do.
  onDeleteNodes: (ids: string[]) => void;
  onDeleteEdges: (ids: string[]) => void;
};

export default function BuilderCanvas({
  nodes,
  edges,
  selectedId,
  waveByNodeId,
  waveUnknown,
  onNodesUpdate,
  onEdgesUpdate,
  onSelectNode,
  onConnectNodes,
  canConnect,
  onDeleteNodes,
  onDeleteEdges,
}: BuilderCanvasProps) {
  // Which node a connection drag started from, or null when no drag is in
  // flight. Local to the canvas because it is transient gesture state — the
  // parent has no use for it and re-rendering the whole builder on every
  // drag start/end would be wasteful.
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        // Grey out anything this drag cannot legally land on (itself, an
        // already-connected target, or any target once MAX_EDGES is hit), so
        // "which one do I connect?" is answered visually during the gesture
        // instead of by a drop that silently does nothing.
        const dimmed =
          connectingFrom !== null && n.id !== connectingFrom && !canConnect(connectingFrom, n.id);
        return {
          ...n,
          selected: n.id === selectedId,
          className: dimmed ? "opacity-25 transition-opacity duration-150" : undefined,
          data: { ...n.data, wave: waveByNodeId[n.id], waveUnknown },
        };
      }),
    [nodes, selectedId, connectingFrom, canConnect, waveByNodeId, waveUnknown],
  );

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable
      // Drag-to-connect is ON. The handles in nodes.tsx were always rendered
      // but inert while this was false, so users dragged them and nothing
      // happened — the actual mechanism was a <select> in a side panel.
      //
      // The old comment here worried that a dragged edge would bypass the
      // select's self-loop/duplicate guards. That worry is honoured by
      // routing BOTH paths through the parent's single addEdge(source,
      // target): `onConnect` below calls it, and the Inspector's "Connect
      // to →" select calls it too. There is one set of guards, not two.
      nodesConnectable
      elementsSelectable
      // Backspace/Delete now work, because onNodesDelete/onEdgesDelete below
      // hand the deletion to the parent, which performs the SAME orphan-edge
      // cleanup as the Inspector's "Delete node" button. (The reason this was
      // previously disabled was that React Flow's own applyNodeChanges would
      // drop a node and leave its edges dangling.)
      deleteKeyCode={["Backspace", "Delete"]}
      onNodesChange={(changes: NodeChange<BuilderFlowNode>[]) =>
        onNodesUpdate(applyNodeChanges(changes, nodes))
      }
      onEdgesChange={(changes: EdgeChange<BuilderFlowEdge>[]) =>
        onEdgesUpdate(applyEdgeChanges(changes, edges))
      }
      onConnect={(connection: Connection) => onConnectNodes(connection.source, connection.target)}
      isValidConnection={(connection) =>
        !!connection.source &&
        !!connection.target &&
        canConnect(connection.source, connection.target)
      }
      onConnectStart={(_, params) => setConnectingFrom(params.nodeId)}
      onConnectEnd={() => setConnectingFrom(null)}
      // React Flow fires these BEFORE the corresponding remove changes, and
      // the parent's handlers use functional setState, so the two compose to
      // the same result rather than clobbering each other.
      onNodesDelete={(deleted) => onDeleteNodes(deleted.map((n) => n.id))}
      onEdgesDelete={(deleted) => onDeleteEdges(deleted.map((e) => e.id))}
      onNodeClick={(_, node) => onSelectNode(node.id)}
      onPaneClick={() => onSelectNode(null)}
      // fitView only on mount (and via Controls' fit-view button) — never
      // on a data-change effect, which would yank the viewport out from
      // under the user every time they add or edit a node.
      //
      // Skipped entirely when the graph is empty, which is NOT a
      // micro-optimisation: getNodesBounds([]) is a zero-size rect, so
      // getViewportForBounds divides by 0, gets Infinity, and clamps to
      // maxZoom — leaving every brand-new workflow at 200% zoom. Steps added
      // afterwards then render double-size and the second column of the
      // placement grid already hangs off the right edge of the canvas.
      onInit={(instance) => {
        if (nodes.length > 0) instance.fitView({ duration: 0 });
      }}
      className="h-full w-full"
      style={flowThemeVars}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--hairline)" />
      <Controls />
    </ReactFlow>
  );
}
