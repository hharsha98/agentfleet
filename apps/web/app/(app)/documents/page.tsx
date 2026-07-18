"use client";

import { useEffect, useRef, useState } from "react";

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

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const res = await apiFetch("/api/v1/documents");
      if (res.ok) setDocs(await res.json());
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

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Icon name="database" />}
        hue="cyan"
        title="Knowledge base"
        description="Upload .txt, .md, or .pdf files and they're chunked and embedded locally. Every agent can then search them and answer from YOUR content, with citations."
      >
        {docs.length > 0 && (
          <span className="font-mono text-xs text-muted">
            {docs.length} document{docs.length === 1 ? "" : "s"}
          </span>
        )}
      </PageHeader>

      <div className="mt-6 flex items-center gap-3 rounded-lg border border-hairline p-4 transition-colors duration-200 focus-within:border-accent/50">
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

      <ul className="mt-6 space-y-2">
        {docs.map((d, i) => (
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
      </ul>
    </main>
  );
}
