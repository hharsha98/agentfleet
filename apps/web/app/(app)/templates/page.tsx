"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/reveal";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api";

function BlocksIcon({ className }: { className?: string }) {
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
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.25" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.25" />
      <rect x="8.5" y="13.5" width="7" height="7" rx="1.25" />
    </svg>
  );
}

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
      const res = await apiFetch("/api/v1/templates");
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
      const res = await apiFetch(`/api/v1/templates/${slug}/install`, {
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
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Icon name="sparkle" />}
        hue="green"
        title="Template gallery"
        description="Starter agents you can install with one click, then customize into your own."
      />
      {note && <p className="mt-3 font-mono text-xs text-muted">{note}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {templates.map((t, i) => {
          const state = installed[t.slug] ?? { status: "idle" as const };
          return (
            <Reveal
              key={t.slug}
              delay={i * 40}
              className="flex flex-col rounded-lg border border-hairline p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/30"
            >
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
                        className="shrink-0 cursor-pointer rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors duration-200 hover:text-foreground"
                      >
                        View in Agents
                      </Link>
                    </div>
                  ) : (
                    <button
                      onClick={() => install(t.slug)}
                      disabled={state.status === "busy"}
                      className="w-full cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {state.status === "busy" ? "Adding…" : "Add to fleet"}
                    </button>
                  )}
                  {state.status === "error" && (
                    <p className="mt-2 font-mono text-xs text-muted">⚠ {state.detail}</p>
                  )}
                </div>
              </Reveal>
            );
          })}
          {templates.length === 0 && !note && (
            <div className="col-span-full">
              <EmptyState
                glyph={<BlocksIcon className="h-7 w-7" />}
                title="No templates available"
                description="The template gallery is empty — check back once the backend seeds starter agents."
              />
            </div>
          )}
        </div>
    </main>
  );
}
