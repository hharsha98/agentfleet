"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Doc = {
  id: string;
  filename: string;
  size_bytes: number;
  status: string;
  created_at: string;
};

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const res = await fetch(`${API_URL}/api/v1/documents`);
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
      const res = await fetch(`${API_URL}/api/v1/documents`, { method: "POST", body: form });
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
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-hairline px-6 py-3">
        <Link href="/" className="font-medium tracking-tight">
          AgentFleet
        </Link>
        <nav className="flex gap-4 text-sm text-muted">
          <Link href="/chat" className="hover:text-foreground">
            Chat
          </Link>
          <span className="text-foreground">Documents</span>
          <Link href="/missions" className="hover:text-foreground">
            Missions
          </Link>
          <Link href="/agents" className="hover:text-foreground">
            Agents
          </Link>
          <Link href="/templates" className="hover:text-foreground">
            Templates
          </Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-medium tracking-tight">Knowledge base</h1>
        <p className="mt-1 text-sm text-muted">
          Uploaded files are chunked and embedded locally; agents search them
          with the <span className="font-mono">search_documents</span> tool.
        </p>

        <div className="mt-6 flex items-center gap-3 rounded-lg border border-hairline p-4">
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.pdf"
            className="flex-1 text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-accent/15 file:px-3 file:py-1.5 file:text-sm file:text-foreground"
          />
          <button
            onClick={upload}
            disabled={busy}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {busy ? "Ingesting…" : "Upload"}
          </button>
        </div>
        {note && <p className="mt-3 font-mono text-xs text-muted">{note}</p>}

        <ul className="mt-6 space-y-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between rounded-lg border border-hairline px-4 py-3 text-sm"
            >
              <span>{d.filename}</span>
              <span className="font-mono text-xs text-muted">
                {(d.size_bytes / 1024).toFixed(1)} kB · {d.status}
              </span>
            </li>
          ))}
          {docs.length === 0 && (
            <li className="pt-8 text-center text-sm text-muted">
              No documents yet — upload a .txt, .md, or .pdf to give your agents
              a knowledge base.
            </li>
          )}
        </ul>
      </main>
    </div>
  );
}
