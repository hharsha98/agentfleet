"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AgentGlyph } from "@/components/agent-visual";
import { Panel } from "@/components/dash/panel";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/landing/icons";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api";

import type { BuilderFlowEdge, BuilderFlowNode, BuilderNodeData } from "./types";

// Lazy + never server-rendered: React Flow touches the DOM during layout,
// and this keeps its chunk out of every other route's bundle. `ssr: false`
// is legal here because this component is already "use client" (verified
// against node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md —
// same idiom as missions/page.tsx:21's FlowCanvas).
const BuilderCanvas = dynamic(() => import("./builder-canvas"), {
  ssr: false,
  loading: () => <p className="pt-24 text-center text-sm text-muted">Loading canvas…</p>,
});

// Server caps from the WorkflowGraphIn contract (apps/api) — mirrored here
// only to grey out controls before a doomed request round-trips. The
// server compiler remains the sole authority; these are advisory.
const MAX_NODES = 40;
const MAX_EDGES = 120;

// New-node placement is a plain grid keyed off a monotonic counter, NOT
// layout.ts's layoutTasks() — that function ranks nodes by run-task
// dependency ordinal, which a hand-built draft graph doesn't have. Builder
// nodes just need "somewhere that doesn't overlap the last node added".
const GRID_COLS = 4;
const GRID_NODE_W = 210;
const GRID_NODE_H = 92;
const GRID_GAP = 48;

const inputClass =
  "w-full rounded-md border border-hairline bg-transparent px-3 py-2 text-sm outline-none transition-colors duration-200 placeholder:text-muted focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";

type Agent = {
  id: string;
  slug: string;
  name: string;
};

type GraphNode = {
  id: string;
  agent_slug: string;
  title: string;
  instruction: string;
  needs_approval: boolean;
  position: { x: number; y: number };
};

type GraphEdge = { id: string; source: string; target: string };

type WorkflowGraph = { schema_version: 1; nodes: GraphNode[]; edges: GraphEdge[] };

type WorkflowOut = {
  id: string;
  name: string;
  description: string;
  node_count: number;
  edge_count: number;
  created_at: string;
  updated_at: string;
  graph: WorkflowGraph;
};

type Snapshot = { name: string; description: string; graph: WorkflowGraph };

// Mirrors WorkflowValidationOut / WorkflowIssue / WorkflowTaskPreview from
// apps/api/app/schemas.py exactly — this is the one place that shape gets
// translated into UI state, same split as WorkflowGraph/WorkflowOut above.
type WorkflowIssue = { code: string; message: string; node_ids: string[] };
type WorkflowTaskPreview = {
  ordinal: number;
  title: string;
  agent_slug: string;
  depends_on: number[];
  needs_approval: boolean;
};
type WorkflowValidationOut = {
  ok: boolean;
  errors: WorkflowIssue[];
  warnings: WorkflowIssue[];
  tasks: WorkflowTaskPreview[];
  estimated_waves: number;
};

type Status = "loading" | "ready" | "not-found" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

// Restricted to the server's `^[A-Za-z0-9_-]{1,64}$` id charset — Date.now
// and Math.random both render in base36 (0-9a-z only), so no separate
// sanitizing step is needed. No nanoid/uuid dependency: none is installed,
// and the plan disallows adding one for this chunk.
function genId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function toGraph(nodes: BuilderFlowNode[], edges: BuilderFlowEdge[]): WorkflowGraph {
  return {
    schema_version: 1,
    nodes: nodes.map((n) => ({
      id: n.id,
      agent_slug: n.data.agentSlug,
      title: n.data.title,
      instruction: n.data.instruction,
      needs_approval: n.data.needsApproval,
      position: n.position,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

function fromGraph(graph: WorkflowGraph): { nodes: BuilderFlowNode[]; edges: BuilderFlowEdge[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: "builder",
      position: n.position,
      data: {
        agentSlug: n.agent_slug,
        title: n.title,
        instruction: n.instruction,
        needsApproval: n.needs_approval,
      },
    })),
    edges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

export default function WorkflowBuilder({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [agents, setAgents] = useState<Agent[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nodes, setNodes] = useState<BuilderFlowNode[]>([]);
  const [edges, setEdges] = useState<BuilderFlowEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodeSeq, setNodeSeq] = useState(0);

  const [lastSaved, setLastSaved] = useState<Snapshot | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [paletteNote, setPaletteNote] = useState<string | null>(null);

  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<WorkflowValidationOut | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [wfRes, agentsRes] = await Promise.all([
          apiFetch(`/api/v1/workflows/${workflowId}`),
          apiFetch("/api/v1/agents"),
        ]);
        if (cancelled) return;

        if (wfRes.status === 404) {
          setStatus("not-found");
          return;
        }
        if (!wfRes.ok) {
          setStatus("error");
          return;
        }

        const workflow: WorkflowOut = await wfRes.json();
        if (agentsRes.ok) setAgents(await agentsRes.json());

        const { nodes: loadedNodes, edges: loadedEdges } = fromGraph(workflow.graph);
        setName(workflow.name);
        setDescription(workflow.description);
        setNodes(loadedNodes);
        setEdges(loadedEdges);
        setNodeSeq(loadedNodes.length);
        setLastSaved({
          name: workflow.name,
          description: workflow.description,
          graph: toGraph(loadedNodes, loadedEdges),
        });
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  const currentGraph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);

  const dirty = useMemo(() => {
    if (!lastSaved) return false;
    return (
      name !== lastSaved.name ||
      description !== lastSaved.description ||
      JSON.stringify(currentGraph) !== JSON.stringify(lastSaved.graph)
    );
  }, [name, description, currentGraph, lastSaved]);

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  // Sets data.invalid on every node named by an error's node_ids (NodeShell
  // paints the red ring off that flag), clearing it everywhere else. Called
  // with `null` to clear all rings — e.g. right before an edit invalidates
  // the last validate result, or when a validate call itself comes back ok.
  function applyInvalidFlags(result: WorkflowValidationOut | null) {
    const invalidIds = new Set<string>();
    if (result && !result.ok) {
      for (const err of result.errors) {
        for (const id of err.node_ids) invalidIds.add(id);
      }
    }
    setNodes((prev) =>
      prev.map((n) => {
        const invalid = invalidIds.has(n.id);
        return (n.data.invalid ?? false) === invalid ? n : { ...n, data: { ...n.data, invalid } };
      }),
    );
  }

  // Any edit to the graph can make a previous validate/run result stale
  // (fixing the cycle that was just flagged, for instance), so every
  // mutator below calls this first — never leave a red ring or an old
  // error message pointing at a graph that no longer exists.
  function clearValidationResult() {
    setValidation(null);
    setValidateError(null);
    setRunError(null);
    applyInvalidFlags(null);
  }

  function addNode(agent: Agent) {
    if (nodes.length >= MAX_NODES) {
      setPaletteNote(`Max ${MAX_NODES} nodes reached.`);
      return;
    }
    setPaletteNote(null);
    clearValidationResult();
    const idx = nodeSeq;
    setNodeSeq(idx + 1);
    const col = idx % GRID_COLS;
    const row = Math.floor(idx / GRID_COLS);
    const node: BuilderFlowNode = {
      id: genId("n"),
      type: "builder",
      position: { x: col * (GRID_NODE_W + GRID_GAP), y: row * (GRID_NODE_H + GRID_GAP) },
      data: {
        agentSlug: agent.slug,
        title: agent.name,
        instruction: "",
        needsApproval: false,
      },
    };
    setNodes((prev) => [...prev, node]);
    setSelectedId(node.id);
  }

  function updateSelectedNode(patch: Partial<BuilderNodeData>) {
    if (!selectedId) return;
    clearValidationResult();
    setNodes((prev) =>
      prev.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  }

  function deleteNode(nodeId: string) {
    clearValidationResult();
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedId((cur) => (cur === nodeId ? null : cur));
  }

  function connectTo(targetId: string) {
    if (!selectedId || targetId === selectedId) return; // no self-loop
    if (edges.some((e) => e.source === selectedId && e.target === targetId)) return; // no duplicate
    if (edges.length >= MAX_EDGES) return;
    clearValidationResult();
    setEdges((prev) => [...prev, { id: genId("e"), source: selectedId, target: targetId }]);
  }

  function deleteEdge(edgeId: string) {
    clearValidationResult();
    setEdges((prev) => prev.filter((e) => e.id !== edgeId));
  }

  // Returns whether the workflow is saved (either it was already clean, or
  // this PUT succeeded) — validate()/run() need that boolean rather than
  // re-reading `dirty`, which is a stale closure by the time an awaited
  // save() resolves and lastSaved has actually changed.
  async function save(): Promise<boolean> {
    if (!dirty) return true;
    if (saveState === "saving") return false;
    setSaveState("saving");
    setSaveError(null);
    try {
      const graph = currentGraph;
      const res = await apiFetch(`/api/v1/workflows/${workflowId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, graph }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body.detail ?? `Save failed (${res.status})`);
        setSaveState("error");
        return false;
      }
      setLastSaved({ name, description, graph });
      setSaveState("saved");
      return true;
    } catch {
      setSaveError("Network error — please retry.");
      setSaveState("error");
      return false;
    }
  }

  // Validate reads the PERSISTED graph server-side, so an unsaved edit
  // would silently validate stale data — save first whenever dirty rather
  // than let that happen. This is also what makes the demo beat work: wire
  // up a cycle (dirty), click Validate, and the save-then-validate chain
  // still lights up the offending nodes in one click.
  async function validate() {
    if (validating) return;
    setValidateError(null);
    if (dirty) {
      const saved = await save();
      if (!saved) {
        setValidateError("Save failed — fix the error above, then try Validate again.");
        return;
      }
    }
    setValidating(true);
    try {
      const res = await apiFetch(`/api/v1/workflows/${workflowId}/validate`, { method: "POST" });
      if (res.ok) {
        const result: WorkflowValidationOut = await res.json();
        setValidation(result);
        applyInvalidFlags(result);
      } else {
        const body = await res.json().catch(() => ({}));
        setValidateError(
          typeof body.detail === "string" ? body.detail : `Validate failed (${res.status})`,
        );
        setValidation(null);
        applyInvalidFlags(null);
      }
    } catch {
      setValidateError("Network error — please retry.");
      setValidation(null);
      applyInvalidFlags(null);
    }
    setValidating(false);
  }

  // Same never-run-a-stale-graph rule as validate(): save first if dirty.
  // On success, navigate straight to the new mission; on a 422 (the graph
  // failed to compile — e.g. a cycle) surface the compiler's message
  // instead of navigating anywhere.
  async function run() {
    if (running) return;
    setRunError(null);
    if (dirty) {
      const saved = await save();
      if (!saved) {
        setRunError("Save failed — fix the error above, then try Run again.");
        return;
      }
    }
    setRunning(true);
    try {
      const res = await apiFetch(`/api/v1/workflows/${workflowId}/run`, { method: "POST" });
      if (res.status === 201) {
        const body: { run_id: string; task_count: number } = await res.json();
        router.push(`/missions?run=${body.run_id}`);
        return;
      }
      const body = await res.json().catch(() => ({}));
      setRunError(typeof body.detail === "string" ? body.detail : `Run failed (${res.status})`);
    } catch {
      setRunError("Network error — please retry.");
    }
    setRunning(false);
  }

  if (status === "loading") {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <p className="pt-24 text-center text-sm text-muted">Loading workflow…</p>
      </main>
    );
  }

  if (status === "not-found") {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <EmptyState
          glyph={<Icon name="workflow" className="h-7 w-7" />}
          title="Workflow not found"
          description="It may have been deleted, or belongs to a different account."
          action={{ href: "/workflows", label: "Back to workflows" }}
        />
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <EmptyState
          glyph={<Icon name="workflow" className="h-7 w-7" />}
          title="Couldn't load this workflow"
          description="API offline — start the backend and reload."
          action={{ href: "/workflows", label: "Back to workflows" }}
        />
      </main>
    );
  }

  const otherNodes = selectedNode ? nodes.filter((n) => n.id !== selectedNode.id) : [];
  const outgoingEdges = selectedNode ? edges.filter((e) => e.source === selectedNode.id) : [];

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Icon name="workflow" />}
        hue="cyan"
        title="Workflow builder"
        description="Add agents, wire them together, save, then validate or run the graph as a mission."
      >
        <Link
          href="/workflows"
          className="cursor-pointer text-sm font-medium text-accent transition-opacity duration-200 hover:opacity-80"
        >
          ← All workflows
        </Link>
      </PageHeader>

      <div className="mt-6 flex flex-col gap-3 rounded-lg border border-hairline p-4 transition-colors duration-200 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workflow name"
            maxLength={120}
            className={`${inputClass} font-medium`}
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            maxLength={1000}
            className={inputClass}
          />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={validate}
              disabled={validating || saveState === "saving"}
              title={dirty ? "Saves your changes, then validates" : "Dry-run — writes nothing"}
              className="cursor-pointer rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors duration-200 hover:border-accent/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {validating ? "Validating…" : "Validate"}
            </button>
            <button
              type="button"
              onClick={run}
              disabled={running || saveState === "saving"}
              title={dirty ? "Saves your changes, then runs" : "Starts a mission from this graph"}
              className="cursor-pointer rounded-md border border-accent/40 px-3 py-2 text-xs font-medium text-accent transition-colors duration-200 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? "Starting…" : "Run"}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saveState === "saving"}
              className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saveState === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
          <span className="font-mono text-[11px] text-muted">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && !dirty && "Saved"}
            {saveState === "error" && (saveError ?? "Save failed — please retry.")}
            {saveState !== "saving" && saveState !== "error" && dirty && "Unsaved changes"}
          </span>
        </div>
      </div>

      {(validation || validateError || runError) && (
        <div className="mt-4 space-y-3 rounded-lg border border-hairline p-4 transition-colors duration-200">
          {validateError && (
            <p
              role="alert"
              className="rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2 font-mono text-xs text-red-400"
            >
              ⚠ {validateError}
            </p>
          )}
          {runError && (
            <p
              role="alert"
              className="rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2 font-mono text-xs text-red-400"
            >
              ⚠ Run failed: {runError}
            </p>
          )}

          {validation && !validation.ok && (
            <div>
              <p className="font-mono text-xs font-medium text-red-400">
                {validation.errors.length} error{validation.errors.length === 1 ? "" : "s"}
              </p>
              <ul className="mt-1.5 space-y-1">
                {validation.errors.map((e, i) => (
                  <li key={i} className="font-mono text-[11px] text-red-300">
                    [{e.code}] {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {validation && validation.warnings.length > 0 && (
            <div>
              <p className="font-mono text-xs font-medium text-amber-300">
                {validation.warnings.length} warning{validation.warnings.length === 1 ? "" : "s"}
              </p>
              <ul className="mt-1.5 space-y-1">
                {validation.warnings.map((w, i) => (
                  <li key={i} className="font-mono text-[11px] text-amber-200">
                    [{w.code}] {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {validation && validation.ok && (
            <p className="font-mono text-xs text-emerald-300">
              Valid{validation.warnings.length > 0 ? " (with warnings above)" : ""} —{" "}
              {validation.estimated_waves} wave{validation.estimated_waves === 1 ? "" : "s"},{" "}
              {validation.tasks.length} task{validation.tasks.length === 1 ? "" : "s"} compiled.
            </p>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[220px_1fr_300px]">
        <Panel title="Agents" description="Click to add to the canvas.">
          <ul className="space-y-1.5">
            {agents.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => addNode(a)}
                  disabled={nodes.length >= MAX_NODES}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-hairline px-2.5 py-2 text-left text-sm transition-colors duration-200 hover:border-accent/30 hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <AgentGlyph slug={a.slug} name={a.name} size="xs" />
                  <span className="truncate">{a.name}</span>
                </button>
              </li>
            ))}
            {agents.length === 0 && (
              <li className="text-xs text-muted">No agents yet — create one first.</li>
            )}
          </ul>
          {paletteNote && <p className="mt-2 font-mono text-[11px] text-muted">{paletteNote}</p>}
        </Panel>

        {/* Hand-rolled chrome instead of <Panel> (which wraps children in
            <Reveal>, animating a transform). A transformed ancestor breaks
            getBoundingClientRect during the reveal — React Flow reads that
            for drag coordinates and fitView, giving skewed drags and a
            zero-size fitView box. Classes copied from components/dash/
            panel.tsx so this still looks like every other card on the page. */}
        <div className="h-[560px] rounded-lg border border-hairline p-4 transition-colors duration-200">
          <BuilderCanvas
            nodes={nodes}
            edges={edges}
            selectedId={selectedId}
            onNodesUpdate={setNodes}
            onEdgesUpdate={setEdges}
            onSelectNode={setSelectedId}
          />
        </div>

        <Panel title="Inspector" description="Edit the selected node.">
          {selectedNode ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block font-mono text-xs text-muted">Title</label>
                <input
                  value={selectedNode.data.title}
                  onChange={(e) => updateSelectedNode({ title: e.target.value })}
                  maxLength={200}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="mb-1 block font-mono text-xs text-muted">Agent</label>
                <select
                  value={selectedNode.data.agentSlug}
                  onChange={(e) => updateSelectedNode({ agentSlug: e.target.value })}
                  className={inputClass}
                >
                  {agents.map((a) => (
                    <option key={a.slug} value={a.slug}>
                      {a.name}
                    </option>
                  ))}
                  {!agents.some((a) => a.slug === selectedNode.data.agentSlug) && (
                    <option value={selectedNode.data.agentSlug}>
                      {selectedNode.data.agentSlug}
                    </option>
                  )}
                </select>
              </div>

              <div>
                <label className="mb-1 block font-mono text-xs text-muted">Instruction</label>
                <textarea
                  value={selectedNode.data.instruction}
                  onChange={(e) => updateSelectedNode({ instruction: e.target.value })}
                  maxLength={8000}
                  rows={5}
                  className={inputClass}
                />
                {selectedNode.data.instruction.trim() === "" && (
                  <p className="mt-1 font-mono text-[11px] text-amber-300/70">
                    No instruction — the agent will only see the title and may just ask for
                    clarification instead of doing the work.
                  </p>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedNode.data.needsApproval}
                  onChange={(e) => updateSelectedNode({ needsApproval: e.target.checked })}
                />
                Needs approval
              </label>

              <div>
                {/* Accessibility note: React Flow's handle-drag is
                    mouse-only with no keyboard path to create an edge —
                    same rationale as the "Accessibility note" on the
                    drag-and-drop mission board at
                    app/(app)/missions/page.tsx (TaskCard, ~line 106): that
                    board keeps a fully keyboard/screen-reader path
                    alongside its native-DnD one, and this select is that
                    path for the builder — choosing a node here creates the
                    edge instead of requiring a handle drag. */}
                <label className="mb-1 block font-mono text-xs text-muted">Connect to →</label>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) connectTo(e.target.value);
                  }}
                  disabled={otherNodes.length === 0 || edges.length >= MAX_EDGES}
                  className={inputClass}
                >
                  <option value="">Choose a node…</option>
                  {otherNodes.map((n) => (
                    <option
                      key={n.id}
                      value={n.id}
                      disabled={edges.some(
                        (e) => e.source === selectedNode.id && e.target === n.id,
                      )}
                    >
                      {n.data.title || "Untitled step"}
                    </option>
                  ))}
                </select>
              </div>

              {outgoingEdges.length > 0 && (
                <div>
                  <p className="mb-1 font-mono text-xs text-muted">Outgoing edges</p>
                  <ul className="space-y-1">
                    {outgoingEdges.map((e) => {
                      const target = nodes.find((n) => n.id === e.target);
                      return (
                        <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate">→ {target?.data.title ?? e.target}</span>
                          <button
                            type="button"
                            onClick={() => deleteEdge(e.id)}
                            className="shrink-0 cursor-pointer text-muted transition-colors duration-200 hover:text-foreground"
                          >
                            Remove
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <button
                type="button"
                onClick={() => deleteNode(selectedNode.id)}
                className="w-full cursor-pointer rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors duration-200 hover:text-foreground"
              >
                Delete node
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted">Select a node on the canvas to edit it.</p>
          )}
        </Panel>
      </div>
    </main>
  );
}
