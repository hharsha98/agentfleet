"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

export default function MissionsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Run | null>(null);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);

  async function refreshRuns() {
    try {
      const res = await fetch(`${API_URL}/api/v1/runs`);
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
        const res = await fetch(`${API_URL}/api/v1/runs/${selected}`);
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
      const res = await fetch(`${API_URL}/api/v1/runs`, {
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
    await fetch(`${API_URL}/api/v1/runs/${selected}/tasks/${taskId}/approve`, {
      method: "POST",
    });
    const res = await fetch(`${API_URL}/api/v1/runs/${selected}`);
    if (res.ok) setDetail(await res.json());
  }

  const tasks = detail?.tasks ?? [];

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-hairline px-6 py-3">
        <Link href="/" className="font-medium tracking-tight">
          AgentFleet
        </Link>
        <nav className="flex gap-4 text-sm text-muted">
          <Link href="/chat" className="hover:text-foreground">
            Chat
          </Link>
          <Link href="/documents" className="hover:text-foreground">
            Documents
          </Link>
          <span className="text-foreground">Missions</span>
          <Link href="/agents" className="hover:text-foreground">
            Agents
          </Link>
          <Link href="/templates" className="hover:text-foreground">
            Templates
          </Link>
          <Link href="/evals" className="hover:text-foreground">
            Evals
          </Link>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createRun();
          }}
          className="flex gap-2"
        >
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Give the fleet a goal — the Orchestrator plans it, agents execute it…"
            className="flex-1 rounded-md border border-hairline bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
          <button
            type="submit"
            disabled={busy || !goal.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
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
                className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors ${
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
                      {items.map((t) => (
                        <div
                          key={t.id}
                          className="rounded-md border border-hairline bg-background p-2.5 text-sm"
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
                              className="mt-2 w-full rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
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
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p className="pt-24 text-center text-sm text-muted">
            {selected
              ? "Loading run…"
              : "Launch a goal or pick a previous run — tasks appear here as a live board."}
          </p>
        )}
      </main>
    </div>
  );
}
