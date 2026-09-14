"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/landing/icons";
import { apiFetch } from "@/lib/api";

// Same blank graph + POST payload as createBlank() on /workflows — this route
// exists so /workflows/new is a real create-then-redirect entry point instead
// of falling through to [id] and fetching GET /api/v1/workflows/new (422).
const BLANK_GRAPH = { schema_version: 1, nodes: [] as unknown[], edges: [] as unknown[] };

type WorkflowSummary = { id: string };

export default function NewWorkflowPage() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;

    async function createAndRedirect() {
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
        if (cancelled) return;
        if (res.ok) {
          const created: WorkflowSummary = await res.json();
          router.replace(`/workflows/${created.id}`);
          return;
        }
        if (!cancelled) setError("Could not create the workflow — please retry.");
      } catch {
        if (!cancelled) {
          setError(
            "API offline — it may be waking up from sleep (~10-20s on the hosted demo) or not running locally. Reload in a moment.",
          );
        }
      }
    }

    createAndRedirect();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <EmptyState
          glyph={<Icon name="workflow" className="h-7 w-7" />}
          title="Couldn't create workflow"
          description={error}
          action={{ href: "/workflows", label: "Back to workflows" }}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <p className="pt-24 text-center text-sm text-muted">Creating workflow…</p>
      <p className="mt-2 text-center text-xs text-muted">
        <Link href="/workflows" className="text-accent transition-opacity duration-200 hover:opacity-80">
          Cancel
        </Link>
      </p>
    </main>
  );
}
