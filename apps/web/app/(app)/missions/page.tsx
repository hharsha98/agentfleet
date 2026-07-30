"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type DragEvent } from "react";

import { AgentGlyph } from "@/components/agent-visual";
import { Panel } from "@/components/dash/panel";
import { StatCard } from "@/components/dash/stat-card";
import { EmptyState } from "@/components/empty-state";
import { HowItWorks, type ExplainerStep } from "@/components/explainer";
import { HUE_CLASSES, Icon, type Hue } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/reveal";
import { MicButton } from "@/components/mic-button";
import { Term } from "@/components/term";
import { TASK_STATUS_GLOW } from "@/components/ui/glow";
import { agentDisplayName } from "@/components/workflow/format";
import type { Task } from "@/components/workflow/types";
import { apiFetch } from "@/lib/api";
import type { GlossaryKey } from "@/lib/glossary";

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

// "muted" (superseded only) isn't a real Hue — see nodes.tsx's STATUS_HUE
// comment for why this reuses that same bypass instead of widening the
// shared Hue union in landing/icons.tsx.
const COLUMNS: { key: Task["status"]; label: string; hue: Hue | "muted" }[] = [
  { key: "todo", label: "To do", hue: "blue" },
  { key: "in_progress", label: "In progress", hue: "violet" },
  { key: "review", label: "Needs approval", hue: "amber" },
  { key: "done", label: "Done", hue: "green" },
  { key: "failed", label: "Failed", hue: "red" },
  // Layer 3 re-planning (orchestrator's append-and-supersede): the task got
  // stuck and was replaced by a repair plan instead of failing outright.
  // NOT a failure — see the card's "Replaced by step N" line. Rendered only
  // when non-empty, same reasoning as "skipped" below.
  { key: "superseded", label: "Replanned", hue: "muted" },
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
// added here too. "skipped" and "superseded" have no entry on purpose — the
// backend has no (skipped, todo) or (superseded, todo) transition (a
// skipped task's dependency is gone for good, and a superseded task's work
// has already moved on to its replacement), so those cards render but are
// never draggable.
const RETRY_TARGET: Partial<Record<Task["status"], Task["status"]>> = {
  failed: "todo",
  review: "todo",
  done: "todo",
};

// One sentence per status, for the legend below the run badge. The board
// only draws a column once something is in it (see boardColumns), so a
// reader meets "Replanned" or "Skipped" for the first time MID-RUN, with a
// new column appearing beside cards they were already reading and nothing on
// screen saying what it means. The legend names all seven states every time,
// whichever columns happen to exist right now.
//
// Keyed by Task["status"] rather than written as a parallel array so a new
// status cannot be added to the board without TypeScript demanding a
// sentence for it here too.
const STATUS_HINT: Record<Task["status"], string> = {
  todo: "Queued. Either its turn hasn't come or it is still waiting on another task.",
  in_progress: "An agent is working on it right now.",
  review: "Parked for you. Nothing that depends on it runs until you approve.",
  done: "Finished. Open “result” on the card to read what came back.",
  failed: "The agent retried, then gave up. The card says what went wrong.",
  superseded: "The orchestrator wrote a repair plan and moved the work to a new step. Not a failure.",
  skipped: "Never ran and never will — something it depended on failed first.",
};

// The two statuses whose column label is also a glossary entry. The other
// five explain themselves in the sentence beside them; these two are jargon
// the app invented ("Replanned" is not a word anyone arrives already
// knowing), so their labels get the dotted underline and the full
// definition on click.
const STATUS_TERM: Partial<Record<Task["status"], GlossaryKey>> = {
  superseded: "superseded",
  skipped: "skipped",
};

const HUE_DOT: Record<Hue, string> = {
  blue: "bg-hue-blue",
  violet: "bg-hue-violet",
  cyan: "bg-hue-cyan",
  amber: "bg-hue-amber",
  green: "bg-hue-green",
  red: "bg-hue-red",
};

// "muted" isn't in the Hue union (see COLUMNS comment above), so the one
// column-header dot that can be "superseded" reads this instead of
// HUE_DOT — keeping HUE_DOT itself an exhaustive, unmodified Record<Hue,_>.
function dotClassFor(hue: Hue | "muted"): string {
  return hue === "muted" ? "bg-muted" : HUE_DOT[hue];
}

// Board grid column count: 5 base columns, +1 each for "skipped" and
// "superseded" once either is non-empty (see boardColumns below). A plain
// lookup rather than a template string — Tailwind's JIT scanner needs
// complete literal class names in source (same reasoning as HUE_DOT/HUE_RING).
const BOARD_GRID_COLS: Record<number, string> = {
  5: "md:grid-cols-5",
  6: "md:grid-cols-6",
  7: "md:grid-cols-7",
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

// The two run statuses that are compound words nobody can guess from the
// badge alone — the board prints them as "done with issues" and "awaiting
// approval", which read like ordinary English but each name a specific
// orchestrator outcome. Both already have a glossary entry, so the badge
// becomes a <Term> for exactly these two and stays plain text for
// planning/running/done/failed, which say what they mean.
const RUN_STATUS_TERM: Partial<Record<string, GlossaryKey>> = {
  done_with_issues: "done_with_issues",
  awaiting_approval: "awaiting_approval",
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

// Run status -> glow on the "Mission status" stat tile. Only one entry, and
// deliberately so: a run that is planning/running already announces itself
// with StatCard's live `pulse` dot, and "done" / "failed" are unambiguous
// words in the tile's own value. "done_with_issues" is the one outcome that
// reads as success at a glance while quietly meaning "something failed or
// was skipped along the way" — the amber ambient glow (same amber
// RUN_BADGE/STATUS_HUE already give it) is what stops it slipping past.
// Static lookup, no template strings, same reason as BOARD_GRID_COLS above.
const RUN_GLOW: Record<string, string> = {
  done_with_issues: "af-glow-amber",
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
      {/* Glow means STATE, hover means border. The card lights up because of
          what happened to the task (TASK_STATUS_GLOW), and answers the cursor
          only with hover:border-accent/30. Glowing on hover instead would
          bloom every card under a mouse sweep, and "this one failed" would
          stop being distinguishable from "the cursor is here".

          Safe to put the glow on this element specifically: it carries no
          ring-* utility (Tailwind rings are box-shadow based and layered, so
          an unlayered .af-glow-* silently eats one) and it is not focusable —
          the only focusable child is the "Approve & run" button, which keeps
          its own focus styles. */}
      <div
        draggable={draggable}
        onDragStart={draggable ? (e) => onDragStart(e, task) : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
        aria-grabbed={draggable ? isDragging : undefined}
        className={`rounded-md border border-hairline bg-background p-2.5 text-sm transition-colors duration-200 hover:border-accent/30 ${
          TASK_STATUS_GLOW[task.status]
        } ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${
          isDragging ? "opacity-40" : ""
        }`}
      >
        <p className="leading-snug">{task.title}</p>

        {/* The card's own step number, beside the agent it runs on. It is
            here because the board already TALKS in ordinals and never showed
            one: "Replaced by step 7" below, "→ step 7" on the graph node,
            and the depends_on ordinals behind "Waiting on N tasks" all name
            a number that appeared nowhere on screen, so following the
            pointer meant counting cards and hoping. Printed verbatim (no +1)
            — it has to be the same integer superseded_by holds. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="flex w-fit items-center gap-1 rounded-full border border-hairline bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-muted">
            <AgentGlyph
              slug={task.agent_slug}
              name={agentDisplayName(task.agent_slug)}
              size="xs"
            />
            {agentDisplayName(task.agent_slug)}
          </span>
          <span className="rounded-full border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-muted">
            Step {task.ordinal}
          </span>
        </div>

        {/* The drag gesture, said out loud on the cards that have one. Until
            now the ONLY hint that a card could be dragged was the cursor
            turning into a grab hand while you happened to be over it, and
            the only feedback for an illegal drop was an error banner after
            the fact — so the whole re-queue path was invisible to anyone who
            didn't try dragging on a hunch. Rendered off the same
            RETRY_TARGET map that decides `draggable`, so the hint can never
            appear on a card that would reject the drop.

            Two wordings because review ≠ done/failed: a card in "Needs
            approval" has not run yet, and dragging it out clears
            needs_approval (see handleDrop's optimistic update) rather than
            re-running anything. */}
        {draggable && (
          <p className="mt-1.5 flex items-center gap-1 font-mono text-[9px] text-muted">
            <span aria-hidden="true">⠿</span>
            {task.status === "review"
              ? "Drag to To do to run it without approving"
              : "Drag to To do to run it again"}
          </p>
        )}

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

        {/* Layer 3 re-planning: reads as "replaced", not "failed" — no red,
            no error icon, just where the work went. superseded_by is an
            ordinal (see types.ts), and following it card-to-card is how a
            reader traces a chain like 3 -> 7 -> 9. */}
        {task.status === "superseded" && (
          <p className="mt-1.5 font-mono text-[10px] text-muted">
            {task.superseded_by != null
              ? `Replaced by step ${task.superseded_by}`
              : "Replaced by a repair plan"}
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
                : task.status === "superseded"
                  ? `re-planned after ${task.attempts} attempts`
                  : `healed after ${task.attempts} attempts`}
            </summary>
            {/* Bounded like the "result" block below: an error string can run
                to a few hundred characters, and rows written before the
                diagnosis was shortened still carry the full repair prompt. */}
            <ul className="mt-1 max-h-40 space-y-1.5 overflow-y-auto text-[11px] leading-relaxed text-muted">
              {task.heal_log.map((h) => (
                <li key={h.attempt}>
                  <span className="text-foreground">Attempt {h.attempt}</span>
                  {/* classification/model already existed on heal_log but
                      weren't surfaced — kept to one inline clause each so
                      this doesn't balloon into a second disclosure. */}
                  {h.classification && <span className="text-muted"> · {h.classification}</span>}
                  {h.model && <span className="text-muted"> · {h.model}</span>}
                  <span className={h.resolved ? "text-emerald-300" : "text-muted"}>
                    {h.resolved ? " · fixed" : " · unresolved"}
                  </span>
                  <span className="mt-0.5 block break-words">{h.error}</span>
                  {/* Only the give-up reasons are worth showing — the
                      mid-loop note just says it retried, which the attempt
                      number already tells you. */}
                  {h.diagnosis?.startsWith("Stopping:") && (
                    <span className="mt-0.5 block break-words text-amber-300/80">
                      {h.diagnosis}
                    </span>
                  )}
                  {h.diagnosis?.startsWith("Re-planned") && (
                    <span className="mt-0.5 block break-words text-muted">{h.diagnosis}</span>
                  )}
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

        {/* The "Drag to To do to retry" line that used to sit under this
            error moved up to the draggable-card hint above — it now shows on
            every card that can be re-queued, not only on the ones that
            happened to record an error string. */}
        {task.error && <p className="mt-2 font-mono text-[10px] text-red-400">⚠ {task.error}</p>}

        {(task.tokens_in > 0 || task.tokens_out > 0) && (
          <p className="mt-2 border-t border-hairline pt-1.5 font-mono text-[10px] text-muted">
            ↑{task.tokens_in} ↓{task.tokens_out}{" "}
            <Term k="tokens">tok</Term>
            {task.latency_ms != null && ` · ${task.latency_ms}ms`}
          </p>
        )}
      </div>
    </Reveal>
  );
}

// Always-visible key to the seven task states, sitting between the run badge
// and the board itself. Reads COLUMNS so the order, the labels and the dot
// colours are the same objects the columns are built from — the legend
// cannot drift from the board it explains.
//
// Rendered above the grid and OUTSIDE the board/graph branch on purpose: the
// graph nodes carry the identical seven statuses (STATUS_LABEL in
// components/workflow/nodes.tsx), so switching views should not take the
// definitions away.
function StatusLegend() {
  return (
    <div className="mt-3 rounded-lg border border-hairline p-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-muted">Status legend</p>
      <dl className="mt-2 grid grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {COLUMNS.map((col) => {
          const termKey = STATUS_TERM[col.key];
          return (
            <div key={col.key} className="flex items-start gap-1.5 text-[11px] leading-snug">
              <span
                aria-hidden="true"
                className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dotClassFor(col.hue)}`}
              />
              <dt className="shrink-0 text-foreground">
                {termKey ? <Term k={termKey}>{col.label}</Term> : col.label}
              </dt>
              <dd className="text-muted">{STATUS_HINT[col.key]}</dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-2.5 border-t border-hairline pt-2 text-[11px] leading-snug text-muted">
        Replanned and Skipped only get a column once a task lands in one, so the board can grow
        a column part-way through a run. Every card carries its own{" "}
        <Term k="ordinal">step number</Term>{" "}
        — that is the number a &quot;Replaced by step 7&quot; line points at. Graph draws these
        same tasks as a{" "}
        <Term k="dag">dependency map</Term>{" "}
        instead of columns: which step waits on which.
      </p>
    </div>
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
  // Undefined for every status that reads plainly on its own (planning,
  // running, done, failed) — the badge stays plain text in that case.
  const runStatusTerm = detail ? RUN_STATUS_TERM[detail.status] : undefined;

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
  // "Skipped" and "superseded" only happen on the self-healing paths (a
  // dependency finally gave up, or the orchestrator re-planned a stuck
  // task) — both uncommon. Showing either column unconditionally cost
  // every other column width and squeezed cards to roughly one word per
  // line, so each appears only once it actually holds something.
  const boardColumns = COLUMNS.filter(
    (c) =>
      (c.key !== "skipped" && c.key !== "superseded") ||
      tasks.some((t) => t.status === c.key),
  );
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
          Give the fleet a goal. The{" "}
          <Term k="orchestrator">orchestrator</Term>{" "}
          splits it into{" "}
          <Term k="task">tasks</Term>
          , assigns agents, and runs them on this live board — pausing for your approval where
          it matters.
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
          label="Missions"
          value={totalRuns ?? runs.length}
          sub={totalRuns != null && totalRuns > runs.length ? `${runs.length} shown` : undefined}
          icon={<Icon name="workflow" />}
          hue="blue"
        />
        <StatCard
          label="Mission status"
          // replaceAll for the same reason as the board badge: replace()
          // takes only the first underscore, so this tile read "done
          // with_issues". No <Term> here — StatCard renders `value` inside a
          // `truncate` paragraph, which would clip the tooltip away
          // entirely; the badge on the board carries the definition.
          value={detail ? detail.status.replaceAll("_", " ") : "—"}
          pulse={!!detail}
          hue={detail ? (STATUS_HUE[detail.status] ?? "blue") : "blue"}
          // StatCard forwards className onto its Reveal root — a plain,
          // non-focusable div with the tile's own rounded-lg, so the glow
          // lands on the right box and collides with no ring-* utility.
          className={detail ? (RUN_GLOW[detail.status] ?? "") : ""}
          delay={40}
        />
        <StatCard
          label="Tasks"
          value={detail ? tasks.length : "—"}
          sub={detail ? taskStatusSummary || "No tasks yet" : "Select a mission"}
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
        <Panel title="Missions" description="Pick a mission to view its board" delay={40}>
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
          // Panel.description is typed `string`, so this cannot carry a
          // <Term> — which is fine: it is the one sentence that has to be
          // readable before anyone knows there is a glossary. It names the
          // gesture, the three statuses it starts from, and the single legal
          // destination, because a drop anywhere else only ever announces
          // itself as a red error banner after the fact.
          description="Cards in Done, Failed and Needs approval can be dragged back to To do to run that task again — To do is the only column that accepts a drop."
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
                  {/* replaceAll, not replace: replace() with a string
                      pattern swaps only the FIRST match, so this badge read
                      "done with_issues" — the one status a reader is most
                      likely to stop and squint at. The <Term> is deliberately
                      INSIDE the badge and outside the truncating goal line
                      beside it: a `truncate` ancestor clips the tooltip
                      entirely. */}
                  {runStatusTerm ? (
                    <Term k={runStatusTerm}>{detail.status.replaceAll("_", " ")}</Term>
                  ) : (
                    detail.status.replaceAll("_", " ")
                  )}
                </span>
                <p className="truncate text-sm text-muted">{detail.goal}</p>
              </div>

              <StatusLegend />

              {dndError && (
                <p
                  role="alert"
                  className="mt-3 rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2 font-mono text-xs text-red-300"
                >
                  ⚠ {dndError}
                </p>
              )}

              {view === "board" ? (
                <div
                  className={`mt-4 grid flex-1 grid-cols-2 gap-3 ${
                    // 5 columns normally; +1 each for "skipped"/"superseded"
                    // once either actually holds a task (see boardColumns
                    // above). Literal classes (not a template string) so
                    // Tailwind's JIT scanner can find them.
                    BOARD_GRID_COLS[boardColumns.length] ?? "md:grid-cols-5"
                  }`}
                >
                  {boardColumns.map((col) => {
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
                            <span className={`h-1.5 w-1.5 rounded-full ${dotClassFor(col.hue)}`} />
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
            <p className="pt-24 text-center text-sm text-muted">Loading mission…</p>
          ) : (
            <EmptyState
              glyph={<RocketIcon className="h-7 w-7" />}
              title="No mission running"
              description="Launch a goal above — tasks appear here as a live board, agent by agent."
            />
          )}
        </Panel>
      </div>

      {/* Same three-card explainer every other screen in the app ends with
          (agents, evals, guardrails, voice, chat all call HowItWorks) —
          missions was the one page that launched real work and never said
          how the screen was meant to be driven. */}
      <HowItWorks title="How a mission works" className="mt-6" delay={20} steps={MISSION_STEPS} />
    </main>
  );
}

const MISSION_STEPS: ExplainerStep[] = [
  {
    hue: "violet",
    title: "Say what you want done",
    description:
      "Type the goal and press Launch. The orchestrator writes the plan — it decides how many steps there are, what each one does, and which agent is best suited to it.",
  },
  {
    hue: "violet",
    title: "Watch it run",
    description:
      "Cards move left to right across the board as agents pick them up. Each one shows its step number, its agent, what it produced, and what it cost. Switch to Graph for the same tasks drawn as a dependency map.",
  },
  {
    hue: "violet",
    title: "Step in where it matters",
    description:
      "Approve anything parked in Needs approval, and drag a Done, Failed or Needs approval card back to To do to put that step back in the queue.",
  },
];
