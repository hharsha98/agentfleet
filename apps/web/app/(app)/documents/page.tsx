"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { BarChart } from "@/components/dash/bar-chart";
import { Panel } from "@/components/dash/panel";
import { StatCard } from "@/components/dash/stat-card";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/reveal";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api";

type Doc = {
  id: string;
  filename: string;
  size_bytes: number;
  status: string;
  created_at: string;
};

function DocumentIcon({ className }: { className?: string }) {
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
      <path d="M6.5 3.5h7.5L18.5 8v12.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M8.5 12.5h6M8.5 15.5h6M8.5 18h3.5" />
    </svg>
  );
}

// Honest relative-age formatter for the "last upload" stat — no library,
// just enough granularity (minutes/hours/days) for a glance-value.
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const res = await apiFetch("/api/v1/documents");
      if (res.ok) {
        setDocs(await res.json());
        const total = res.headers.get("X-Total-Count");
        setTotalCount(total ? Number(total) : null);
      }
    } catch {
      setNote("API offline — start the backend and reload.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file || busy) return;
    setBusy(true);
    setNote(`Ingesting ${file.name}… (first upload loads the embedding model)`);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch("/api/v1/documents", { method: "POST", body: form });
      const body = await res.json();
      setNote(
        res.ok
          ? `✓ ${body.filename} ingested into ${body.chunks} chunk${body.chunks === 1 ? "" : "s"}`
          : `⚠ ${body.detail ?? `upload failed (${res.status})`}`,
      );
      if (res.ok) refresh();
    } catch (err) {
      setNote(`⚠ ${String(err)}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const docCount = totalCount ?? docs.length;
  // Honest caveat: size/last-upload are computed from the fetched page of
  // documents (up to the list endpoint's default limit), not a separate
  // aggregate endpoint — the list endpoint doesn't return chunk counts, so
  // we show what we can verify from its actual payload instead of a
  // fabricated "total chunks" figure.
  const totalSize = useMemo(() => docs.reduce((sum, d) => sum + d.size_bytes, 0), [docs]);
  const lastUpload = docs[0] ?? null;

  const filteredDocs = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => d.filename.toLowerCase().includes(q));
  }, [docs, filter]);

  // Upload activity by day, derived client-side from the fetched documents
  // (created_at) — no new backend endpoint, real data only.
  const uploadsByDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of docs) {
      const day = d.created_at.slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, value]) => ({ label: date.slice(5), value, tooltip: `${date}: ${value} upload${value === 1 ? "" : "s"}` }));
  }, [docs]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Icon name="database" />}
        hue="cyan"
        title="Knowledge base"
        description="Upload .txt, .md, or .pdf files and they're chunked and embedded locally. Every agent can then search them and answer from YOUR content, with citations."
      >
        {docs.length > 0 && (
          <span className="font-mono text-xs text-muted">
            {docCount} document{docCount === 1 ? "" : "s"}
          </span>
        )}
      </PageHeader>

      {note && !busy && docs.length === 0 && <p className="mt-3 font-mono text-xs text-muted">{note}</p>}

      {/* Stat row */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard
          label="Documents"
          value={docCount}
          icon={<Icon name="database" />}
          hue="cyan"
          delay={0}
        />
        <StatCard
          label="Fetched size"
          value={fmtBytes(totalSize)}
          sub={docs.length > 0 ? `across ${docs.length} loaded doc${docs.length === 1 ? "" : "s"}` : undefined}
          icon={<Icon name="file-text" />}
          hue="blue"
          delay={40}
        />
        <StatCard
          label="Last upload"
          value={lastUpload ? timeAgo(lastUpload.created_at) : "—"}
          sub={lastUpload ? lastUpload.filename : "no documents yet"}
          icon={<Icon name="clock" />}
          hue="violet"
          delay={80}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Upload a document" description="Chunked and embedded locally on ingest." delay={0}>
          <div className="flex items-center gap-3 rounded-lg border border-hairline p-4 transition-colors duration-200 focus-within:border-accent/50">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.pdf"
              className="flex-1 text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-accent/15 file:px-3 file:py-1.5 file:text-sm file:text-foreground file:transition-colors file:duration-200 hover:file:bg-accent/25"
            />
            <button
              onClick={upload}
              disabled={busy}
              className="shrink-0 cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Ingesting…" : "Upload"}
            </button>
          </div>
          {note && <p className="mt-3 font-mono text-xs text-muted">{note}</p>}
        </Panel>

        <Panel
          title="How agents use this"
          description="The search_documents tool, honestly explained."
          delay={40}
        >
          <div className="flex items-start gap-3">
            <div
              aria-hidden="true"
              className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-hue-cyan/10 border-hue-cyan/25"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-2 rounded-full bg-hue-cyan/20 blur-lg"
              />
              <Icon name="search" className="relative h-4.5 w-4.5 text-hue-cyan" />
            </div>
            <p className="text-sm text-muted">
              Every agent can call <code className="font-mono text-xs text-foreground">search_documents</code> —
              it runs a semantic search over these embeddings and returns the closest chunks with a
              relevance score, which the agent cites in its reply. No document is used unless the
              agent&apos;s own reasoning decides to search.
            </p>
          </div>
          {uploadsByDay.length > 1 && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs text-muted">Uploads by day (loaded documents)</p>
              <BarChart
                data={uploadsByDay}
                hue="cyan"
                title="Documents uploaded per day"
                height={72}
              />
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Documents"
          action={
            docs.length > 0 ? (
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by filename…"
                className="w-48 rounded-md border border-hairline bg-transparent px-3 py-1.5 text-xs outline-none transition-colors duration-200 placeholder:text-muted focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
              />
            ) : undefined
          }
          delay={80}
        >
          <ul className="space-y-2">
            {filteredDocs.map((d, i) => (
              <li key={d.id}>
                <Reveal
                  delay={i * 40}
                  className="flex items-center justify-between rounded-lg border border-hairline px-4 py-3 text-sm transition-colors duration-200 hover:border-accent/30"
                >
                  <span>{d.filename}</span>
                  <span className="font-mono text-xs text-muted">
                    {(d.size_bytes / 1024).toFixed(1)} kB · {d.status}
                  </span>
                </Reveal>
              </li>
            ))}
            {docs.length === 0 && (
              <li>
                <EmptyState
                  glyph={<DocumentIcon className="h-7 w-7" />}
                  title="No documents yet"
                  description="Upload a .txt, .md, or .pdf above to give your agents a knowledge base."
                />
              </li>
            )}
            {docs.length > 0 && filteredDocs.length === 0 && (
              <li className="py-8 text-center text-sm text-muted">No documents match “{filter}”.</li>
            )}
          </ul>
        </Panel>
      </div>
    </main>
  );
}
