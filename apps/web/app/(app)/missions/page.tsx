"use client";

import { useEffect, useState, type DragEvent } from "react";

import { EmptyState } from "@/components/empty-state";
import { HUE_CLASSES, Icon, type Hue } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/reveal";
import { apiFetch } from "@/lib/api";

type Task = {
  id: string;
  ordinal: number;
  title: string;
  description: string;
  agent_slug: string;
  depends_on: number[];
  needs_approval: boolean;
  status: "todo" | "in_progress" | "review" | "done" | "failed";
  result: string;
  error: string | null;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number | null;
};

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
];

// Mirrors the backend's ALLOWED_TASK_TRANSITIONS (apps/api/app/routes/runs.py)
// — client-side legality check for drag targets. Every currently-allowed
// re-queue move lands on "todo", so a card is only ever draggable if its
// status is a key here, and the only column that ever highlights as a
// legal drop target is "todo". Kept as an explicit map (not hardcoded to
// "todo" everywhere) so a future backend transition just needs one entry
// added here too.
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

// Same slug -> hue hash idiom as chat-ui.tsx / landing/roster.tsx, so an
// agent's chip color is consistent everywhere it appears.
const HUES: Hue[] = ["blue", "violet", "cyan", "amber", "green", "red"];

function hueForSlug(slug: string): Hue {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  }
  return HUES[Math.abs(hash) % HUES.length];
}

function agentDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const RUN_BADGE: Record<string, string> = {
  planning: "border-accent/40 text-accent",
  running: "border-accent/40 text-accent",
  awaiting_approval: "border-amber-400/40 text-amber-300",
  done: "border-emerald-400/40 text-emerald-300",
  failed: "border-red-400/40 text-red-300",
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
  const hue = hueForSlug(task.agent_slug);
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
          <span className={`h-1.5 w-1.5 rounded-full ${HUE_DOT[hue]}`} />
          {agentDisplayName(task.agent_slug)}
        </span>

        {waitingOn > 0 && (
          <p className="mt-1.5 font-mono text-[10px] text-muted">
            Waiting on {waitingOn} task{waitingOn === 1 ? "" : "s"}
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
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Run | null>(null);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);

  // Drag-and-drop state (UI-5 Chunk C).
  const [draggingTask, setDraggingTask] = useState<{ id: string; status: Task["status"] } | null>(
    null,
  );
  const [dragOverColumn, setDragOverColumn] = useState<Task["status"] | null>(null);
  const [dndError, setDndError] = useState<string | null>(null);

  async function refreshRuns() {
    try {
      const res = await apiFetch("/api/v1/runs");
      if (res.ok) setRuns(await res.json());
    } catch {
      /* API offline — page shows empty state */
    }
  }

  useEffect(() => {
    refreshRuns();
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
        <button
          type="submit"
          disabled={busy || !goal.trim()}
          className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Launching…" : "Launch"}
        </button>
      </form>

      {runs.length > 0 && (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {runs.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setSelected(r.id);
                setDetail(null);
              }}
              className={`cursor-pointer whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors duration-200 ${
                r.id === selected
                  ? "border-accent bg-accent/15 text-foreground"
                  : "border-hairline text-muted hover:text-foreground"
              }`}
            >
              {r.goal.slice(0, 48)}
              {r.goal.length > 48 ? "…" : ""}
            </button>
          ))}
        </div>
      )}

      {detail ? (
        <>
          <div className="mt-5 flex items-center gap-3">
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

          <div className="mt-4 grid flex-1 grid-cols-2 gap-3 md:grid-cols-5">
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
    </main>
  );
}
