"use client";

import { useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { HUE_CLASSES, Icon } from "@/components/landing/icons";
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

const COLUMNS: { key: Task["status"]; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "review", label: "Needs approval" },
  { key: "done", label: "Done" },
  { key: "failed", label: "Failed" },
];

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

export default function MissionsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Run | null>(null);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);

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

          <div className="mt-4 grid flex-1 grid-cols-2 gap-3 md:grid-cols-5">
            {COLUMNS.map((col) => {
              const items = tasks.filter((t) => t.status === col.key);
              return (
                <div key={col.key} className="rounded-lg border border-hairline p-2">
                  <p className="px-1 pb-2 font-mono text-[11px] uppercase tracking-wide text-muted">
                    {col.label} · {items.length}
                  </p>
                  <div className="space-y-2">
                    {items.map((t, i) => (
                      <Reveal
                        key={t.id}
                        delay={i * 40}
                        className="rounded-md border border-hairline bg-background p-2.5 text-sm transition-colors duration-200 hover:border-accent/30"
                      >
                        <p className="leading-snug">{t.title}</p>
                        <p className="mt-1.5 font-mono text-[10px] text-muted">
                          {t.agent_slug}
                          {t.depends_on.length > 0 && ` · after #${t.depends_on.join(", #")}`}
                        </p>
                        {t.status === "in_progress" && (
                          <span className="mt-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                        )}
                        {t.status === "review" && (
                          <button
                            onClick={() => approve(t.id)}
                            className="mt-2 w-full cursor-pointer rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-white transition-opacity duration-200 hover:opacity-90"
                          >
                            Approve & run
                          </button>
                        )}
                        {t.result && (
                          <details className="mt-2">
                            <summary className="cursor-pointer font-mono text-[10px] text-muted">
                              result
                            </summary>
                            <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted">
                              {t.result}
                            </pre>
                          </details>
                        )}
                        {t.error && (
                          <p className="mt-2 font-mono text-[10px] text-red-400">⚠ {t.error}</p>
                        )}
                        {(t.tokens_in > 0 || t.tokens_out > 0) && (
                          <p className="mt-2 border-t border-hairline pt-1.5 font-mono text-[10px] text-muted">
                            ↑{t.tokens_in} ↓{t.tokens_out} tok
                            {t.latency_ms != null && ` · ${t.latency_ms}ms`}
                          </p>
                        )}
                      </Reveal>
                    ))}
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
