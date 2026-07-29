"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type DragEvent } from "react";

import { AgentGlyph } from "@/components/agent-visual";
import { Panel } from "@/components/dash/panel";
import { StatCard } from "@/components/dash/stat-card";
import { EmptyState } from "@/components/empty-state";
import { HUE_CLASSES, Icon, type Hue } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/reveal";
import { MicButton } from "@/components/mic-button";
import { agentDisplayName } from "@/components/workflow/format";
import type { Task } from "@/components/workflow/types";
import { apiFetch } from "@/lib/api";

// Lazy + never server-rendered: React Flow touches the DOM during layout,
// and this keeps its chunk out of every other route's bundle. `ssr: false`
// is legal here because this page is already "use client" (verified against
// node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md).
const FlowCanvas = dynamic(() => import("@/components/workflow/flow-canvas"), {
  ssr: false,
  loading: () => <p className="pt-24 text-center text-sm text-muted">Loading graph…</p>,
});

type Run = {
  id: string;
  goal: string;
  status: string;
  created_at: string;
  tasks?: Task[];
};

const COLUMNS: { key: Task["status"]; label: string; hue: Hue }[] = [
  { key: "todo", label: "To do", hue: "blue" },
  { key: "in_progress", label: "In progress", hue: "violet" },
  { key: "review", label: "Needs approval", hue: "amber" },
  { key: "done", label: "Done", hue: "green" },
  { key: "failed", label: "Failed", hue: "red" },
  // Never runs (a dependency failed/skipped first) — cyan because it's the
  // one hue not already claimed by another status here. Mirrored in
  // components/workflow/nodes.tsx's STATUS_HUE; keep both in sync.
  { key: "skipped", label: "Skipped", hue: "cyan" },
];

// Mirrors the backend's ALLOWED_TASK_TRANSITIONS (apps/api/app/routes/runs.py)
// — client-side legality check for drag targets. Every currently-allowed
// re-queue move lands on "todo", so a card is only ever draggable if its
// status is a key here, and the only column that ever highlights as a
// legal drop target is "todo". Kept as an explicit map (not hardcoded to
// "todo" everywhere) so a future backend transition just needs one entry
// added here too. "skipped" has no entry on purpose — the backend has no
// (skipped, todo) transition (a skipped task's dependency is gone for good),
// so skipped cards render but are never draggable.
const RETRY_TARGET: Partial<Record<Task["status"], Task["status"]>> = {
  failed: "todo",
  review: "todo",
  done: "todo",
};

const HUE_DOT: Record<Hue, string> = {
  blue: "bg-hue-blue",
  violet: "bg-hue-violet",
  cyan: "bg-hue-cyan",
  amber: "bg-hue-amber",
  green: "bg-hue-green",
  red: "bg-hue-red",
};

const RUN_BADGE: Record<string, string> = {
  planning: "border-accent/40 text-accent",
  running: "border-accent/40 text-accent",
  awaiting_approval: "border-amber-400/40 text-amber-300",
  done: "border-emerald-400/40 text-emerald-300",
  failed: "border-red-400/40 text-red-300",
  // Everything terminal, but something failed or was skipped along the way —
  // amber-ish because it's neither a clean success nor an outright failure.
  done_with_issues: "border-amber-400/40 text-amber-300",
};

// Stat-row hue per run status (Chunk D2) — same status vocabulary as
// RUN_BADGE above, remapped onto the shared Hue palette for StatCard's dot.
const STATUS_HUE: Record<string, Hue> = {
  planning: "blue",
  running: "blue",
  awaiting_approval: "amber",
  done: "green",
  failed: "red",
  done_with_issues: "amber",
};

function RocketIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3c2.8 1.6 4.5 4.6 4.5 8.5 0 2-1 4-2.3 5.3L12 19l-2.2-2.2C8.5 15.5 7.5 13.5 7.5 11.5 7.5 7.6 9.2 4.6 12 3Z" />
      <circle cx="12" cy="10.5" r="1.6" />
      <path d="M9.3 16.5 7 19M14.7 16.5 17 19" />
    </svg>
  );
}

// One task card. Cards can only ever be dragged FROM a status that has a
// legal re-queue target (failed/review/done — see RETRY_TARGET) TO the "To
// do" column; todo/in_progress cards render non-draggable (no legal move
// exists for them today).
//
// Accessibility note: this is native HTML5 drag-and-drop, which has no
// built-in keyboard path. `aria-grabbed` is set for assistive tech that
// understands the drag protocol, but full keyboard re-ordering (e.g.
// space-to-pick-up, arrow-to-move, space-to-drop) is out of scope for this
// pass — the "Approve & run" button remains a fully keyboard/screen-reader
// accessible equivalent for review→todo, and this is the one status where
// no drag-only action exists.
function TaskCard({
  task,
  tasks,
  delay,
  isDragging,
  onApprove,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  tasks: Task[];
  delay: number;
  isDragging: boolean;
  onApprove: (taskId: string) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, task: Task) => void;
  onDragEnd: () => void;
}) {
  const draggable = RETRY_TARGET[task.status] != null;
  const doneOrdinals = new Set(tasks.filter((t) => t.status === "done").map((t) => t.ordinal));
  const waitingOn = task.depends_on.filter((d) => !doneOrdinals.has(d)).length;

  return (
    <Reveal delay={delay}>
      <div
        draggable={draggable}
        onDragStart={draggable ? (e) => onDragStart(e, task) : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
        aria-grabbed={draggable ? isDragging : undefined}
        className={`rounded-md border border-hairline bg-background p-2.5 text-sm transition-colors duration-200 hover:border-accent/30 ${
          draggable ? "cursor-grab active:cursor-grabbing" : ""
        } ${isDragging ? "opacity-40" : ""}`}
      >
        <p className="leading-snug">{task.title}</p>

        <span className="mt-1.5 flex w-fit items-center gap-1 rounded-full border border-hairline bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-muted">
          <AgentGlyph
            slug={task.agent_slug}
            name={agentDisplayName(task.agent_slug)}
            size="xs"
          />
          {agentDisplayName(task.agent_slug)}
        </span>

        {/* Only "todo" is actually waiting on something that might still
            complete — a "skipped" task's blocking dependency has already
            failed/skipped for good, so showing "waiting" there would imply
            work that will never happen. */}
        {task.status === "todo" && waitingOn > 0 && (
          <p className="mt-1.5 font-mono text-[10px] text-muted">
            Waiting on {waitingOn} task{waitingOn === 1 ? "" : "s"}
          </p>
        )}

        {task.status === "skipped" && (
          <p className="mt-1.5 font-mono text-[10px] text-muted">
            Skipped — a dependency didn&apos;t finish
          </p>
        )}

        {task.status === "review" && task.needs_approval && (
          <span
            className={`mt-1.5 inline-block rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${HUE_CLASSES.amber.tile} ${HUE_CLASSES.amber.icon}`}
          >
            Needs approval
          </span>
        )}

        {task.status === "in_progress" && (
          <span className="mt-2 flex items-center gap-1 font-mono text-[10px] text-accent">
            <span className="h-2 w-2 animate-spin-slow rounded-full border border-accent/40 border-t-accent" />
            Agent working…
          </span>
        )}

        {task.status === "review" && (
          <button
            onClick={() => onApprove(task.id)}
            className="mt-2 w-full cursor-pointer rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-white transition-opacity duration-200 hover:opacity-90"
          >
            Approve & run
          </button>
        )}

        {/* Self-heal story (orchestrator retries a failing task before
            giving up) — reuses the same details/summary disclosure as
            "result" below instead of inventing a new one. attempts > 1
            means the orchestrator diagnosed and retried at least once. */}
        {task.attempts > 1 && (
          <details className="mt-2">
            <summary className="cursor-pointer font-mono text-[10px] text-muted">
              {task.status === "failed"
                ? `gave up after ${task.attempts} attempts`
                : `healed after ${task.attempts} attempts`}
            </summary>
            <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-muted">
              {task.heal_log.map((h) => (
                <li key={h.attempt}>
                  <span className="text-foreground">Attempt {h.attempt}:</span> {h.error} —{" "}
                  {h.diagnosis} {h.resolved ? "(resolved)" : "(unresolved)"}
                </li>
              ))}
            </ul>
          </details>
        )}

        {task.result && (
          <details className="mt-2">
            <summary className="cursor-pointer font-mono text-[10px] text-muted">
              result
            </summary>
            <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted">
              {task.result}
            </pre>
          </details>
        )}

        {task.error && (
          <>
            <p className="mt-2 font-mono text-[10px] text-red-400">⚠ {task.error}</p>
            <p className="mt-0.5 font-mono text-[9px] text-muted">Drag to To do to retry</p>
          </>
        )}

        {(task.tokens_in > 0 || task.tokens_out > 0) && (
          <p className="mt-2 border-t border-hairline pt-1.5 font-mono text-[10px] text-muted">
            ↑{task.tokens_in} ↓{task.tokens_out} tok
            {task.latency_ms != null && ` · ${task.latency_ms}ms`}
          </p>
        )}
      </div>
    </Reveal>
  );
}

export default function MissionsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  // X-Total-Count from GET /runs (Chunk D2 stat row) — the runs array itself
  // is page-limited (default 20), so this is the only source of the real
  // total. null until the first successful fetch resolves.
  const [totalRuns, setTotalRuns] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Run | null>(null);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  // Board | Graph toggle (Stage 1 of the visual workflow feature) — the
  // graph is a read-only alternate view of the same already-fetched tasks,
  // no new state or requests needed to drive it.
  const [view, setView] = useState<"board" | "graph">("board");

  // Drag-and-drop state (UI-5 Chunk C).
  const [draggingTask, setDraggingTask] = useState<{ id: string; status: Task["status"] } | null>(
    null,
  );
  const [dragOverColumn, setDragOverColumn] = useState<Task["status"] | null>(null);
  const [dndError, setDndError] = useState<string | null>(null);

  async function refreshRuns() {
    try {
      const res = await apiFetch("/api/v1/runs");
      if (res.ok) {
        setRuns(await res.json());
        const total = res.headers.get("X-Total-Count");
        setTotalRuns(total ? Number(total) : null);
      }
    } catch {
      /* API offline — page shows empty state */
    }
  }

  useEffect(() => {
    refreshRuns();
  }, []);

  // Deep-link from the workflow builder's Run button (?run=<id>) — read via
  // window.location.search in a plain mount effect rather than
  // next/navigation's useSearchParams, which requires a Suspense boundary a
  // page like this one doesn't otherwise need. This runs once on mount, so
  // it only seeds the initial selection; it does not react to later History
  // API navigations to this same page.
  //
  // The setSelected call is nested inside its own function (declared and
  // invoked from within the effect, same shape as workflow-builder.tsx's
  // load() effect) rather than sitting at the effect's own top level —
  // react-hooks/set-state-in-effect flags a setState call it can trace
  // directly in the effect body, and this is the established pattern in
  // this codebase for a mount-effect state seed that avoids that.
  useEffect(() => {
    function seedSelectedFromQuery() {
      const runId = new URLSearchParams(window.location.search).get("run");
      if (runId) setSelected(runId);
    }
    seedSelectedFromQuery();
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function tick() {
      try {
        const res = await apiFetch(`/api/v1/runs/${selected}`);
        if (!res.ok || cancelled) return;
        const r: Run = await res.json();
        setDetail(r);
        if (["done", "failed"].includes(r.status) && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch {
        /* transient poll failure — next tick retries */
      }
    }
    tick();
    timer = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [selected]);

  async function createRun() {
    const text = goal.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/v1/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: text }),
      });
      if (res.ok) {
        const run = await res.json();
        setGoal("");
        setSelected(run.id);
        setDetail(null);
        refreshRuns();
      }
    } finally {
      setBusy(false);
    }
  }

  async function approve(taskId: string) {
    if (!selected) return;
    await apiFetch(`/api/v1/runs/${selected}/tasks/${taskId}/approve`, {
      method: "POST",
    });
    const res = await apiFetch(`/api/v1/runs/${selected}`);
    if (res.ok) setDetail(await res.json());
  }

  function handleDragStart(e: DragEvent<HTMLDivElement>, task: Task) {
    e.dataTransfer.setData("text/plain", task.id);
    e.dataTransfer.effectAllowed = "move";
    setDndError(null);
    setDraggingTask({ id: task.id, status: task.status });
  }

  function handleDragEnd() {
    setDraggingTask(null);
    setDragOverColumn(null);
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>, targetStatus: Task["status"]) {
    e.preventDefault();
    setDragOverColumn(null);
    const taskId = e.dataTransfer.getData("text/plain");
    setDraggingTask(null);
    const task = tasks.find((t) => t.id === taskId);
    if (!selected || !task || RETRY_TARGET[task.status] !== targetStatus) return;

    const prev = { status: task.status, error: task.error, needs_approval: task.needs_approval };

    // Optimistic move — the 3s poll (or the fresh re-fetch below on
    // success) reconciles with the server either way.
    setDetail((d) =>
      d
        ? {
            ...d,
            tasks: (d.tasks ?? []).map((t) =>
              t.id === taskId
                ? { ...t, status: targetStatus, error: null, needs_approval: false }
                : t,
            ),
          }
        : d,
    );

    const res = await apiFetch(`/api/v1/runs/${selected}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: targetStatus }),
    });

    if (!res.ok) {
      let message = "That move isn't allowed.";
      try {
        const body = await res.json();
        if (body?.detail) message = body.detail;
      } catch {
        /* non-JSON error body — keep the generic message */
      }
      setDndError(message);
      // Revert the optimistic move.
      setDetail((d) =>
        d
          ? {
              ...d,
              tasks: (d.tasks ?? []).map((t) => (t.id === taskId ? { ...t, ...prev } : t)),
            }
          : d,
      );
      return;
    }

    const fresh = await apiFetch(`/api/v1/runs/${selected}`);
    if (fresh.ok) setDetail(await fresh.json());
  }

  const tasks = detail?.tasks ?? [];

  // Chunk D2 stat row — derived from the already-fetched runs/detail state,
  // no new endpoints. Task-status breakdown and token totals only mean
  // anything once a run is selected, so they read "—"/"No tasks yet" until
  // then rather than showing misleading zeros.
  const taskStatusSummary = COLUMNS.map((c) => ({
    label: c.label,
    count: tasks.filter((t) => t.status === c.key).length,
  }))
    .filter((c) => c.count > 0)
    .map((c) => `${c.count} ${c.label.toLowerCase()}`)
    .join(" · ");
  const tokensIn = tasks.reduce((sum, t) => sum + t.tokens_in, 0);
  const tokensOut = tasks.reduce((sum, t) => sum + t.tokens_out, 0);
  const tokensTotal = tokensIn + tokensOut;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8">
      {/* Missions has no printed heading in the design — the goal input
          reads as the header — but still gets a real h1 for a11y. The icon
          + description below is a compact strip (not the full PageHeader,
          which would render a second visible h1) so it stays consistent
          with this page's sr-only-heading layout. */}
      <h1 className="sr-only">Missions</h1>

      <Reveal className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border ${HUE_CLASSES.violet.tile}`}
        >
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute -inset-2 rounded-full ${HUE_CLASSES.violet.glow} blur-lg`}
          />
          <Icon name="workflow" className={`relative h-5 w-5 ${HUE_CLASSES.violet.icon}`} />
        </div>
        <p className="max-w-2xl pt-2 text-sm text-muted">
          Give the fleet a goal. The orchestrator splits it into tasks, assigns agents, and
          runs them on this live board — pausing for your approval where it matters.
        </p>
      </Reveal>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          createRun();
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Give the fleet a goal — the Orchestrator plans it, agents execute it…"
          className="flex-1 rounded-md border border-hairline bg-transparent px-3 py-2 text-sm outline-none transition-colors duration-200 placeholder:text-muted focus:border-accent"
        />
        <MicButton onTranscript={(t) => setGoal((v) => (v ? v + " " + t : t))} />
        <button
          type="submit"
          disabled={busy || !goal.trim()}
          className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Launching…" : "Launch"}
        </button>
      </form>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Runs"
          value={totalRuns ?? runs.length}
          sub={totalRuns != null && totalRuns > runs.length ? `${runs.length} shown` : undefined}
          icon={<Icon name="workflow" />}
          hue="blue"
        />
        <StatCard
          label="Run status"
          value={detail ? detail.status.replace("_", " ") : "—"}
          pulse={!!detail}
          hue={detail ? (STATUS_HUE[detail.status] ?? "blue") : "blue"}
          delay={40}
        />
        <StatCard
          label="Tasks"
          value={detail ? tasks.length : "—"}
          sub={detail ? taskStatusSummary || "No tasks yet" : "Select a run"}
          icon={<Icon name="list-checks" />}
          hue="violet"
          delay={80}
        />
        <StatCard
          label="Tokens spent"
          value={detail ? tokensTotal.toLocaleString() : "—"}
          sub={detail && tokensTotal > 0 ? `↑${tokensIn} ↓${tokensOut}` : undefined}
          icon={<Icon name="activity" />}
          hue="cyan"
          delay={120}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[280px_1fr]">
        <Panel title="Runs" description="Pick a mission to view its board" delay={40}>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:pb-0">
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setSelected(r.id);
                  setDetail(null);
                }}
                title={r.goal}
                className={`flex max-w-[240px] min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors duration-200 lg:w-full lg:max-w-none lg:shrink lg:justify-start lg:whitespace-normal lg:rounded-md lg:px-3 lg:py-2 ${
                  r.id === selected
                    ? "border-accent bg-accent/15 text-foreground"
                    : "border-hairline text-muted hover:text-foreground"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${HUE_DOT[STATUS_HUE[r.status] ?? "blue"]}`}
                />
                <span className="truncate">{r.goal}</span>
              </button>
            ))}
            {runs.length === 0 && (
              <p className="text-xs text-muted">No missions yet — launch one above.</p>
            )}
          </div>
        </Panel>

        <Panel
          title="Board"
          delay={80}
          className="lg:min-h-[420px]"
          action={
            <div
              role="tablist"
              aria-label="Board view"
              className="flex items-center gap-1 rounded-md border border-hairline p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={view === "board"}
                onClick={() => setView("board")}
                className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors duration-200 ${
                  view === "board"
                    ? "bg-accent/15 text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Board
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "graph"}
                onClick={() => setView("graph")}
                className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors duration-200 ${
                  view === "graph"
                    ? "bg-accent/15 text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Graph
              </button>
            </div>
          }
        >
          {detail ? (
            <>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full border px-2.5 py-0.5 font-mono text-xs ${
                    RUN_BADGE[detail.status] ?? "border-hairline text-muted"
                  }`}
                >
                  {detail.status.replace("_", " ")}
                </span>
                <p className="truncate text-sm text-muted">{detail.goal}</p>
              </div>

              {dndError && (
                <p
                  role="alert"
                  className="mt-3 rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2 font-mono text-xs text-red-300"
                >
                  ⚠ {dndError}
                </p>
              )}

              {view === "board" ? (
                <div className="mt-4 grid flex-1 grid-cols-2 gap-3 md:grid-cols-6">
                  {COLUMNS.map((col) => {
                    const items = tasks.filter((t) => t.status === col.key);
                    const isLegalTarget =
                      draggingTask != null && RETRY_TARGET[draggingTask.status] === col.key;
                    const isDragOver = isLegalTarget && dragOverColumn === col.key;

                    return (
                      <div
                        key={col.key}
                        onDragOver={
                          isLegalTarget
                            ? (e) => {
                                e.preventDefault();
                                setDragOverColumn(col.key);
                              }
                            : undefined
                        }
                        onDragLeave={
                          isLegalTarget
                            ? () => setDragOverColumn((c) => (c === col.key ? null : c))
                            : undefined
                        }
                        onDrop={isLegalTarget ? (e) => handleDrop(e, col.key) : undefined}
                        className={`rounded-lg border p-2 transition-colors duration-150 ${
                          isDragOver
                            ? "border-accent bg-accent/[0.06] ring-2 ring-accent/40"
                            : "border-hairline"
                        }`}
                      >
                        <div className="flex items-center justify-between px-1 pb-2">
                          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted">
                            <span className={`h-1.5 w-1.5 rounded-full ${HUE_DOT[col.hue]}`} />
                            {col.label}
                          </span>
                          <span className="rounded-full border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-muted">
                            {items.length}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {items.length === 0 ? (
                            <div className="flex h-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-hairline text-muted">
                              <Icon name="list-checks" className="h-3.5 w-3.5" />
                              <span className="font-mono text-[10px]">All clear</span>
                            </div>
                          ) : (
                            items.map((t, i) => (
                              <TaskCard
                                key={t.id}
                                task={t}
                                tasks={tasks}
                                delay={i * 40}
                                isDragging={draggingTask?.id === t.id}
                                onApprove={approve}
                                onDragStart={handleDragStart}
                                onDragEnd={handleDragEnd}
                              />
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div key={detail.id} className="mt-4 h-[420px] rounded-lg border border-hairline">
                  <FlowCanvas tasks={tasks} />
                </div>
              )}
            </>
          ) : selected ? (
            <p className="pt-24 text-center text-sm text-muted">Loading run…</p>
          ) : (
            <EmptyState
              glyph={<RocketIcon className="h-7 w-7" />}
              title="No mission running"
              description="Launch a goal above — tasks appear here as a live board, agent by agent."
            />
          )}
        </Panel>
      </div>
    </main>
  );
}
