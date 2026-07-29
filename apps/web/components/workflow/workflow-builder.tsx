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
import { WORKFLOW_EXAMPLES, type WorkflowExample } from "@/lib/workflow-examples";
import { issueCopy } from "@/lib/workflow-issues";

import { builderWaveRanks, H_GAP, NODE_H, NODE_W, V_GAP } from "./layout";
import type { BuilderFlowEdge, BuilderFlowNode, BuilderNodeData } from "./types";

// One sentence, reused wherever the word "wave" appears (the canvas legend,
// each node's wave tooltip in nodes.tsx, the Validate success line) so it is
// never an unexplained term. Semantics come straight from estimated_waves()
// in apps/api/app/services/workflow_compiler.py: one execute_run while-loop
// iteration, i.e. every step whose dependencies are already satisfied.
const WAVE_EXPLAINER =
  "A wave is one batch of steps that can run at the same time, because nothing in the batch depends on anything else in it.";

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
  // Already served by AgentOut and previously discarded. The palette listed
  // 17 bare names with no indication of what any of them does, so picking
  // one was guesswork — a real run ended up asking Clinical Research to list
  // programming languages purely because it sorts first alphabetically.
  description: string;
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

  // Wave = which batch a step runs in. Recomputed on every graph edit so the
  // number on each node is live while you wire things up, rather than only
  // appearing as a single "{n} waves" total after a successful Validate (the
  // only place the word used to exist anywhere in the app).
  const waves = useMemo(
    () =>
      builderWaveRanks(
        nodes.map((n) => n.id),
        edges,
      ),
    [nodes, edges],
  );

  // Sets data.invalid on every node named by an error's node_ids (NodeShell
  // paints the red ring off that flag), clearing it everywhere else. Called
  // with `null` to clear all rings — e.g. right before an edit invalidates
  // the last validate result, or when a validate call itself comes back ok.
  function applyInvalidFlags(result: WorkflowValidationOut | null) {
    // id -> the humanized sentence for the FIRST error naming that node.
    // Errors are ordered by the compiler's own check sequence (duplicate_id,
    // empty, self_loop, dangling_edge, unknown_agent, cycle) and it raises on
    // the first failure, so in practice there is exactly one — but keeping
    // the first-wins rule makes the tooltip deterministic regardless.
    const reasonById = new Map<string, string>();
    if (result && !result.ok) {
      for (const err of result.errors) {
        for (const id of err.node_ids) {
          if (!reasonById.has(id)) reasonById.set(id, issueCopy(err.code).sentence);
        }
      }
    }
    setNodes((prev) =>
      prev.map((n) => {
        const invalid = reasonById.has(n.id);
        const invalidReason = reasonById.get(n.id);
        if ((n.data.invalid ?? false) === invalid && n.data.invalidReason === invalidReason) {
          return n;
        }
        return { ...n, data: { ...n.data, invalid, invalidReason } };
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

  // Fills the CURRENT canvas from a curated example (lib/workflow-examples.ts)
  // and marks it dirty — it deliberately does NOT create a second workflow.
  // The /workflows page's example row does the create-then-navigate version;
  // this one is for the empty canvas you are already standing in, so "load an
  // example to see how this works" costs one click and no stray records.
  //
  // Only offered while the canvas is empty (see the overlay below), which is
  // also what makes it safe to replace state wholesale: there is nothing of
  // the user's to destroy, and the example's fixed node ids can't collide.
  function loadExample(example: WorkflowExample) {
    const { nodes: exampleNodes, edges: exampleEdges } = fromGraph(example.graph);
    clearValidationResult();
    setPaletteNote(null);
    setNodes(exampleNodes);
    setEdges(exampleEdges);
    setNodeSeq(exampleNodes.length);
    setSelectedId(exampleNodes[0]?.id ?? null);
    // Never clobber a name the user actually typed. "Untitled workflow" is
    // the placeholder the /workflows page's createBlank() writes, so it
    // counts as unset for this purpose.
    if (!name.trim() || name === "Untitled workflow") setName(example.name);
    if (!description.trim()) setDescription(example.description);
  }

  // OPT-IN only, wired to a button the user has to press. Never called from an
  // effect or from any edit path: graph.nodes[].position is persisted user
  // data, and silently rearranging someone's canvas because they added an
  // edge is hostile — they placed those boxes on purpose.
  //
  // Same column/row math as layoutTasks() in layout.ts, so an arranged
  // builder graph and the run DAG for the same workflow read identically.
  function arrangeByWave() {
    // A loop means builderWaveRanks() produced no usable ordering, so there
    // are no columns to arrange into. Deliberately no clearValidationResult()
    // here either: this only moves boxes, and positions are invisible to the
    // compiler — exactly like dragging a node, which also leaves the last
    // validate result standing.
    if (waves.hasCycle || nodes.length === 0) return;
    const byRank = new Map<number, string[]>();
    for (const n of nodes) {
      const rank = waves.rankById[n.id] ?? 0;
      const group = byRank.get(rank);
      if (group) group.push(n.id);
      else byRank.set(rank, [n.id]);
    }
    const nextPosition = new Map<string, { x: number; y: number }>();
    let minY = 0;
    for (const [rank, ids] of byRank) {
      ids.forEach((id, i) => {
        // Each column is centred on y=0 so a fan-in step lines up with the
        // middle of the steps feeding it — same expression as layoutTasks().
        const y = i * (NODE_H + V_GAP) - ((ids.length - 1) * (NODE_H + V_GAP)) / 2;
        if (y < minY) minY = y;
        nextPosition.set(id, { x: rank * (NODE_W + H_GAP), y });
      });
    }
    // …then shift the whole thing back into positive space. layoutTasks() can
    // leave negative y because the run DAG calls fitView right after; the
    // builder deliberately never moves the viewport on a data change, so a
    // node at y=-116 would simply scroll off the top of the canvas and look
    // like "Arrange by wave" lost a step.
    setNodes((prev) =>
      prev.map((n) => {
        const position = nextPosition.get(n.id);
        return position ? { ...n, position: { x: position.x, y: position.y - minY } } : n;
      }),
    );
  }

  function updateSelectedNode(patch: Partial<BuilderNodeData>) {
    if (!selectedId) return;
    clearValidationResult();
    setNodes((prev) =>
      prev.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  }

  function deleteNode(nodeId: string) {
    deleteNodes([nodeId]);
  }

  // Bulk form, because React Flow's Backspace/Delete can remove a multi-
  // selection in one go. Same orphan-edge cleanup the single-node Inspector
  // button always did: drop the nodes AND every edge touching them, so the
  // graph can never be saved with a dangling_edge the compiler would reject.
  function deleteNodes(nodeIds: string[]) {
    if (nodeIds.length === 0) return;
    const doomed = new Set(nodeIds);
    clearValidationResult();
    setNodes((prev) => prev.filter((n) => !doomed.has(n.id)));
    setEdges((prev) => prev.filter((e) => !doomed.has(e.source) && !doomed.has(e.target)));
    setSelectedId((cur) => (cur !== null && doomed.has(cur) ? null : cur));
  }

  // THE one place an edge is allowed to come into existence, and therefore
  // the one place the rules live. Both creation paths call it:
  //   - the Inspector's "Connect to →" select, via connectTo() below
  //   - dragging from a node's right dot to another node's left dot, via
  //     BuilderCanvas's onConnect
  //
  // React Flow ships its own addEdge() helper that appends a Connection to an
  // edge array. Calling THAT from onConnect is exactly the bypass the old
  // `nodesConnectable={false}` comment was worried about — it would create
  // edges without any of the four guards below. It is deliberately not used.
  function addEdge(sourceId: string, targetId: string) {
    if (!canConnect(sourceId, targetId)) return;
    clearValidationResult();
    setEdges((prev) => [...prev, { id: genId("e"), source: sourceId, target: targetId }]);
  }

  // The guards as a pure predicate so the canvas can also grey out illegal
  // targets mid-drag, instead of letting the user drop an edge that silently
  // evaporates. Kept in sync with addEdge by construction: addEdge calls it.
  function canConnect(sourceId: string, targetId: string): boolean {
    if (!sourceId || !targetId) return false;
    if (sourceId === targetId) return false; // no self-loop (compiler: self_loop)
    if (edges.some((e) => e.source === sourceId && e.target === targetId)) return false; // no duplicate
    if (edges.length >= MAX_EDGES) return false;
    return true;
  }

  function connectTo(targetId: string) {
    if (!selectedId) return;
    addEdge(selectedId, targetId);
  }

  function deleteEdge(edgeId: string) {
    deleteEdges([edgeId]);
  }

  function deleteEdges(edgeIds: string[]) {
    if (edgeIds.length === 0) return;
    const doomed = new Set(edgeIds);
    clearValidationResult();
    setEdges((prev) => prev.filter((e) => !doomed.has(e.id)));
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
        description="Click an agent to add a step. Drag from a step's right dot to another step's left dot to make the second one wait for the first. Then Save, and Validate before you run it."
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
              className="cursor-pointer rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors duration-200 hover:border-accent/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {validating ? "Validating…" : "Validate"}
            </button>
            <button
              type="button"
              onClick={run}
              disabled={running || saveState === "saving"}
              className="cursor-pointer rounded-md border border-accent/40 px-3 py-2 text-xs font-medium text-accent transition-colors duration-200 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? "Starting…" : "Run"}
            </button>
            {/* Still disabled when clean — pressing it would PUT an identical
                graph for nothing. But a greyed button labelled "Save" on
                arrival reads as broken, so when there is nothing to save it
                says exactly that instead. NOT the word "Saved": the status
                line below already renders that, and e2e/workflows.spec.ts
                does getByText("Saved", { exact: true }) — a second exact
                match would be a Playwright strict-mode violation. */}
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saveState === "saving"}
              className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saveState === "saving" ? "Saving…" : dirty ? "Save" : "No changes to save"}
            </button>
          </div>
          <span className="font-mono text-[11px] text-muted">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && !dirty && "Saved"}
            {saveState === "error" && (saveError ?? "Save failed — please retry.")}
            {saveState !== "saving" && saveState !== "error" && dirty && "Unsaved changes"}
          </span>
          {/* This used to live in a `title=` on each button, i.e. nowhere a
              user would find it. Validate and Run both read the PERSISTED
              graph server-side, so they save first whenever there are
              unsaved edits — say so on the page. */}
          <span className="text-right text-[11px] text-muted">
            Validate and Run save your changes first.
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

          {/* Findings used to render as `[cycle] Cycle detected among
              node(s): 'Draft' (n8kq…)` — an internal code and a machine
              message, with no statement of what to do. Now: a plain sentence,
              the concrete fix, and the raw code kept visible in small mono
              (both for anyone searching the codebase and because
              e2e/workflows.spec.ts asserts getByText(/empty_instruction/)).
              The compiler's own wording moves to the row's hover title, where
              it names the exact node ids without adding noise. */}
          {validation && !validation.ok && (
            <div>
              {/* The count is wrapped in its own <span> so its text is
                  EXACTLY "1 error" — e2e/workflows.spec.ts asserts
                  getByText("1 error", { exact: true }), and Playwright keeps
                  only the innermost matching element, so the trailing clause
                  on the <p> cannot break that match. */}
              <p className="font-mono text-xs font-medium text-red-400">
                <span>
                  {validation.errors.length} error{validation.errors.length === 1 ? "" : "s"}
                </span>{" "}
                — nothing will run until this is fixed
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {validation.errors.map((e, i) => {
                  const copy = issueCopy(e.code);
                  return (
                    <li key={i} className="text-[11px] leading-snug" title={e.message}>
                      <span className="text-red-300">{copy.sentence}</span>{" "}
                      <span className="font-mono text-[10px] text-red-300/50">{e.code}</span>
                      <span className="mt-0.5 block text-muted">Fix: {copy.fix}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {validation && validation.warnings.length > 0 && (
            <div>
              {/* Same exact-text contract as the error count above:
                  getByText("1 warning", { exact: true }). */}
              <p className="font-mono text-xs font-medium text-amber-300">
                <span>
                  {validation.warnings.length} warning{validation.warnings.length === 1 ? "" : "s"}
                </span>{" "}
                — this still runs, but check it
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {validation.warnings.map((w, i) => {
                  const copy = issueCopy(w.code);
                  return (
                    <li key={i} className="text-[11px] leading-snug" title={w.message}>
                      <span className="text-amber-200">{copy.sentence}</span>{" "}
                      <span className="font-mono text-[10px] text-amber-200/50">{w.code}</span>
                      <span className="mt-0.5 block text-muted">Fix: {copy.fix}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Keeps the leading word "Valid" — e2e/workflows.spec.ts asserts
              getByText(/^Valid\b/) — but says what that actually means, and
              defines "wave" instead of dropping the term on the user. */}
          {validation && validation.ok && (
            <p className="text-xs leading-snug text-emerald-300">
              Valid{validation.warnings.length > 0 ? ", with the warnings above" : ""} — this
              compiles into {validation.tasks.length} step
              {validation.tasks.length === 1 ? "" : "s"} running in {validation.estimated_waves} wave
              {validation.estimated_waves === 1 ? "" : "s"}.{" "}
              <span className="text-muted">{WAVE_EXPLAINER}</span>
            </p>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[220px_1fr_300px]">
        <Panel title="Agents" description="Click to add to the canvas.">
          {/* data-testid, not the `ul.space-y-1.5` class chain the spec used
              to select on: that chain silently breaks the moment this list's
              spacing is restyled, and there are four other `space-y-1.5`
              lists elsewhere in the app. e2e/workflows.spec.ts is migrated to
              this hook in the same change. */}
          <ul data-testid="agent-palette" className="space-y-1.5">
            {agents.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => addNode(a)}
                  disabled={nodes.length >= MAX_NODES}
                  title={a.description || a.name}
                  className="flex w-full cursor-pointer flex-col gap-0.5 rounded-md border border-hairline px-2.5 py-2 text-left text-sm transition-colors duration-200 hover:border-accent/30 hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="flex items-center gap-2">
                    <AgentGlyph slug={a.slug} name={a.name} size="xs" />
                    <span className="truncate">{a.name}</span>
                  </span>
                  {/* One truncated line, plus the full text on hover. Enough
                      to tell these apart at a glance without turning a
                      17-item list into a wall of prose. */}
                  {a.description && (
                    <span className="line-clamp-2 text-[11px] leading-snug text-muted">
                      {a.description}
                    </span>
                  )}
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
        <div className="flex flex-col gap-2">
          {/* `relative` (a containing block, NOT a transform) so the empty
              state below can be absolutely positioned over the canvas —
              transforms are the thing React Flow cannot tolerate here, per
              the note above; position:relative changes nothing it measures. */}
          <div className="relative h-[560px] rounded-lg border border-hairline p-4 transition-colors duration-200">
            <BuilderCanvas
              nodes={nodes}
              edges={edges}
              selectedId={selectedId}
              waveByNodeId={waves.rankById}
              waveUnknown={waves.hasCycle}
              onNodesUpdate={setNodes}
              onEdgesUpdate={setEdges}
              onSelectNode={setSelectedId}
              onConnectNodes={addEdge}
              canConnect={canConnect}
              onDeleteNodes={deleteNodes}
              onDeleteEdges={deleteEdges}
            />

            {/* Zero-node state. The old blank grid was the single worst moment
                in this screen: a dotted void, a 17-item palette, and no
                statement of what a workflow even is. Two ways out — read the
                three steps, or load a finished example and look at it.
                pointer-events-none on the backdrop keeps the canvas
                pannable; the card itself re-enables them. */}
            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
                <div className="pointer-events-auto max-w-sm rounded-lg border border-hairline bg-background/95 p-4 text-center">
                  <p className="text-sm font-medium">Start your first workflow</p>
                  <ol className="mt-3 space-y-1.5 text-left text-xs text-muted">
                    <li>1. Click an agent on the left to add a step.</li>
                    <li>
                      2. Drag from a step&apos;s <span className="text-accent">right dot</span> to
                      another step&apos;s <span className="text-accent">left dot</span> to make the
                      second one wait for the first.
                    </li>
                    <li>3. Save, then Validate to check the graph before running it.</li>
                  </ol>
                  <p className="mt-3 text-left text-xs text-muted">
                    Or load a finished example into this canvas:
                  </p>
                  <div className="mt-2 flex flex-wrap justify-start gap-1.5">
                    {WORKFLOW_EXAMPLES.map((example) => (
                      <button
                        key={example.id}
                        type="button"
                        onClick={() => loadExample(example)}
                        title={example.description}
                        className="cursor-pointer rounded-md border border-hairline px-2 py-1 text-[11px] transition-colors duration-200 hover:border-accent/40 hover:bg-accent/5"
                      >
                        {example.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Canvas legend. Defines "wave" (the number now printed on every
              node) and names the two keyboard/mouse gestures that were
              previously undiscoverable — dragging between dots, and Backspace
              to delete. */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="max-w-md text-[11px] leading-snug text-muted">
              {WAVE_EXPLAINER}{" "}
              {waves.hasCycle
                ? "Wave numbers are greyed out because these steps form a loop."
                : `This graph needs ${waves.waveCount} wave${waves.waveCount === 1 ? "" : "s"}.`}{" "}
              Select a step or a connection and press Backspace to delete it.
            </p>
            {/* Opt-in, never automatic: node positions are saved user data. */}
            <button
              type="button"
              onClick={arrangeByWave}
              disabled={nodes.length === 0 || waves.hasCycle}
              title="Moves every step into a column for its wave. Changes positions only — you still have to Save."
              className="shrink-0 cursor-pointer rounded-md border border-hairline px-2.5 py-1.5 text-[11px] text-muted transition-colors duration-200 hover:border-accent/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Arrange by wave
            </button>
          </div>
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
                {/* Accessibility note — STILL LOAD-BEARING now that
                    drag-to-connect works: React Flow's handle-drag is
                    mouse-only with no keyboard path to create an edge —
                    same rationale as the "Accessibility note" on the
                    drag-and-drop mission board at
                    app/(app)/missions/page.tsx (TaskCard, ~line 106): that
                    board keeps a fully keyboard/screen-reader path
                    alongside its native-DnD one, and this select is that
                    path for the builder — choosing a node here creates the
                    edge instead of requiring a handle drag.
                    Both paths call the same addEdge(source, target), so they
                    cannot disagree about what is a legal edge. */}
                <label className="mb-1 block font-mono text-xs text-muted">Connect to →</label>
                <select
                  data-testid="connect-select"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) connectTo(e.target.value);
                  }}
                  disabled={otherNodes.length === 0 || edges.length >= MAX_EDGES}
                  className={inputClass}
                >
                  {/* Option text is load-bearing: e2e/workflows.spec.ts selects
                      this control with .filter({ hasText: "Choose a node…" }).
                      Kept verbatim, with data-testid added above as the
                      durable hook for the new tests. */}
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
                <p className="mt-1 text-[11px] leading-snug text-muted">
                  Or drag from this step&apos;s right dot on the canvas to another step&apos;s left
                  dot — same result.
                </p>
              </div>

              {outgoingEdges.length > 0 && (
                <div data-testid="outgoing-edges">
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
