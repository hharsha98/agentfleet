"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Panel } from "@/components/dash/panel";
import { StatCard } from "@/components/dash/stat-card";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/reveal";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api";

type WorkflowSummary = {
  id: string;
  name: string;
  description: string;
  node_count: number;
  edge_count: number;
  created_at: string;
  updated_at: string;
};

// A blank workflow per the API contract (WorkflowGraphIn defaults) — created
// eagerly so "Open blank builder" can jump straight into a real, addressable
// /workflows/{id} rather than a client-only draft state.
const BLANK_GRAPH = { schema_version: 1, nodes: [] as unknown[], edges: [] as unknown[] };

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  // X-Total-Count from GET /workflows — the list itself is page-limited
  // (default 20), same idiom as automations/page.tsx's schedule/webhook totals.
  const [total, setTotal] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);

  async function refresh() {
    try {
      const res = await apiFetch("/api/v1/workflows");
      if (res.ok) {
        setWorkflows(await res.json());
        const totalHeader = res.headers.get("X-Total-Count");
        setTotal(totalHeader ? Number(totalHeader) : null);
        setNote(null);
      } else {
        setNote("API offline — start the backend and reload.");
      }
    } catch {
      setNote("API offline — start the backend and reload.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createBlank() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await apiFetch("/api/v1/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Untitled workflow",
          description: "",
          graph: BLANK_GRAPH,
        }),
      });
      if (res.ok) {
        const created: WorkflowSummary = await res.json();
        router.push(`/workflows/${created.id}`);
        return;
      }
      setNote("Could not create the workflow — please retry.");
    } catch {
      setNote("Could not create the workflow — please retry.");
    }
    // Re-enable the button; a silent no-op here reads as a dead control.
    setCreating(false);
  }

  async function deleteWorkflow(workflow: WorkflowSummary) {
    if (!confirm(`Delete workflow "${workflow.name}"? This cannot be undone.`)) return;
    setDeleteBusy((b) => ({ ...b, [workflow.id]: true }));
    try {
      const res = await apiFetch(`/api/v1/workflows/${workflow.id}`, { method: "DELETE" });
      if (res.ok) refresh();
      else setNote(`Could not delete "${workflow.name}" — please retry.`);
    } finally {
      setDeleteBusy((b) => ({ ...b, [workflow.id]: false }));
    }
  }

  // Stat row: total workflow count (server-authoritative via X-Total-Count
  // when available) and total nodes across the workflows actually shown —
  // a page-limited sum, same honesty tradeoff as templates/page.tsx's
  // "matched by slug" note, since the API has no server-computed node total.
  const totalNodes = workflows.reduce((sum, w) => sum + w.node_count, 0);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Icon name="workflow" />}
        hue="cyan"
        title="Workflows"
        description="Hand-build a graph of agent steps, wire them together, and run the whole thing as one mission."
      >
        <button
          type="button"
          onClick={createBlank}
          disabled={creating}
          className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {creating ? "Creating…" : "New workflow"}
        </button>
      </PageHeader>
      {note && <p className="mt-3 font-mono text-xs text-muted">{note}</p>}

      <div className="mt-6 grid max-w-md grid-cols-2 gap-3">
        <StatCard
          label="Workflows"
          value={total ?? workflows.length}
          icon={<Icon name="workflow" />}
          hue="cyan"
        />
        <StatCard
          label="Total nodes"
          value={totalNodes}
          sub="across workflows shown"
          icon={<Icon name="blocks" />}
          hue="blue"
          delay={40}
        />
      </div>

      <Panel
        title="Your workflows"
        description="Hand-built agent graphs you can run as a mission."
        className="mt-6"
        delay={80}
      >
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {workflows.map((w, i) => (
            <Reveal
              key={w.id}
              delay={i * 40}
              className="af-hover-nav flex flex-col rounded-lg border border-hairline p-4"
            >
              <Link
                href={`/workflows/${w.id}`}
                className="cursor-pointer text-sm font-medium transition-colors duration-200 hover:text-accent"
              >
                {w.name}
              </Link>
              {w.description && <p className="mt-2 flex-1 text-sm text-muted">{w.description}</p>}
              <p className="mt-3 font-mono text-[11px] text-muted">
                {w.node_count} nodes · {w.edge_count} edges
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted">
                Updated {new Date(w.updated_at).toLocaleString()}
              </p>

              <div className="mt-4 flex items-center justify-between gap-2">
                <Link
                  href={`/workflows/${w.id}`}
                  className="cursor-pointer text-xs font-medium text-accent transition-opacity duration-200 hover:opacity-80"
                >
                  Open →
                </Link>
                <button
                  onClick={() => deleteWorkflow(w)}
                  disabled={deleteBusy[w.id]}
                  className="shrink-0 cursor-pointer rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors duration-200 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </Reveal>
          ))}
          {workflows.length === 0 && !note && (
            <div className="col-span-full flex flex-col items-center gap-4">
              <EmptyState
                glyph={<Icon name="workflow" className="h-7 w-7" />}
                title="No workflows yet"
                description="Build a graph of agent steps and run it as one mission."
              />
              {/* Not EmptyState's `action` prop — that renders a plain Link to
                  a static href, but this CTA must POST a new workflow first
                  and then navigate to the id the API returns. */}
              <button
                type="button"
                onClick={createBlank}
                disabled={creating}
                className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {creating ? "Creating…" : "Open blank builder"}
              </button>
            </div>
          )}
        </div>
      </Panel>
    </main>
  );
}
