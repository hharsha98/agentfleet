"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Template = {
  slug: string;
  name: string;
  description: string;
  system_prompt: string;
  tools: string[];
  category: "research" | "writing" | "ops";
};

type InstallState = {
  status: "idle" | "busy" | "done" | "error";
  detail?: string;
  agentId?: string;
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Record<string, InstallState>>({});

  async function refresh() {
    try {
      const res = await fetch(`${API_URL}/api/v1/templates`);
      if (res.ok) {
        setTemplates(await res.json());
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

  async function install(slug: string) {
    setInstalled((s) => ({ ...s, [slug]: { status: "busy" } }));
    try {
      const res = await fetch(`${API_URL}/api/v1/templates/${slug}/install`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setInstalled((s) => ({ ...s, [slug]: { status: "done", agentId: body.id } }));
      } else {
        setInstalled((s) => ({
          ...s,
          [slug]: { status: "error", detail: body.detail ?? `Install failed (${res.status})` },
        }));
      }
    } catch (err) {
      setInstalled((s) => ({ ...s, [slug]: { status: "error", detail: String(err) } }));
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
          <Link href="/documents" className="hover:text-foreground">
            Documents
          </Link>
          <Link href="/missions" className="hover:text-foreground">
            Missions
          </Link>
          <Link href="/agents" className="hover:text-foreground">
            Agents
          </Link>
          <span className="text-foreground">Templates</span>
          <Link href="/evals" className="hover:text-foreground">
            Evals
          </Link>
          <Link href="/usage" className="hover:text-foreground">
            Usage
          </Link>
          <Link href="/automations" className="hover:text-foreground">
            Automations
          </Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-medium tracking-tight">Template gallery</h1>
        <p className="mt-1 text-sm text-muted">
          One-click starting points — install a template and it appears as a
          ready-to-edit agent in your fleet.
        </p>
        {note && <p className="mt-3 font-mono text-xs text-muted">{note}</p>}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {templates.map((t) => {
            const state = installed[t.slug] ?? { status: "idle" as const };
            return (
              <div key={t.slug} className="flex flex-col rounded-lg border border-hairline p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className="shrink-0 rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] text-muted">
                    {t.category}
                  </span>
                </div>
                <p className="mt-2 flex-1 text-sm text-muted">{t.description}</p>
                {t.tools.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {t.tools.map((tool) => (
                      <span
                        key={tool}
                        className="rounded-full border border-hairline px-2.5 py-0.5 font-mono text-[10px] text-muted"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-4">
                  {state.status === "done" ? (
                    <div className="flex items-center gap-2">
                      <button
                        disabled
                        className="flex-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white opacity-40"
                      >
                        Added ✓
                      </button>
                      <Link
                        href="/agents"
                        className="shrink-0 rounded-md border border-hairline px-3 py-2 text-xs text-muted hover:text-foreground"
                      >
                        View in Agents
                      </Link>
                    </div>
                  ) : (
                    <button
                      onClick={() => install(t.slug)}
                      disabled={state.status === "busy"}
                      className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
                    >
                      {state.status === "busy" ? "Adding…" : "Add to fleet"}
                    </button>
                  )}
                  {state.status === "error" && (
                    <p className="mt-2 font-mono text-xs text-muted">⚠ {state.detail}</p>
                  )}
                </div>
              </div>
            );
          })}
          {templates.length === 0 && !note && (
            <p className="col-span-full pt-8 text-center text-sm text-muted">
              No templates available.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
