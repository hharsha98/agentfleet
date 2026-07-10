"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Agent = {
  id: string;
  slug: string;
  name: string;
  description: string;
  model: string;
  system_prompt: string;
  temperature: number;
  tools: string[];
  is_builtin: boolean;
};

type FormState = {
  name: string;
  slug: string;
  description: string;
  system_prompt: string;
  model: string;
  temperature: string;
  tools: string[];
};

const EMPTY_FORM: FormState = {
  name: "",
  slug: "",
  description: "",
  system_prompt: "",
  model: "",
  temperature: "0.7",
  tools: [],
};

const inputClass =
  "w-full rounded-md border border-hairline bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent disabled:opacity-50";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [toolNames, setToolNames] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [agentsRes, toolsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/agents`),
        fetch(`${API_URL}/api/v1/agents/tools`),
      ]);
      if (agentsRes.ok) setAgents(await agentsRes.json());
      if (toolsRes.ok) setToolNames(await toolsRes.json());
      if (!agentsRes.ok || !toolsRes.ok) {
        setNote("API offline — start the backend and reload.");
      } else {
        setNote(null);
      }
    } catch {
      setNote("API offline — start the backend and reload.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function openCreateForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(agent: Agent) {
    setEditingId(agent.id);
    setForm({
      name: agent.name,
      slug: agent.slug,
      description: agent.description,
      system_prompt: agent.system_prompt,
      model: agent.model,
      temperature: String(agent.temperature),
      tools: agent.tools,
    });
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  function toggleTool(name: string) {
    setForm((f) => ({
      ...f,
      tools: f.tools.includes(name) ? f.tools.filter((t) => t !== name) : [...f.tools, name],
    }));
  }

  async function submitForm() {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const temperature = Number(form.temperature);
      if (editingId) {
        const res = await fetch(`${API_URL}/api/v1/agents/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            description: form.description,
            system_prompt: form.system_prompt,
            model: form.model,
            temperature,
            tools: form.tools,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setFormError(body.detail ?? `Update failed (${res.status})`);
          return;
        }
      } else {
        const res = await fetch(`${API_URL}/api/v1/agents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            slug: form.slug,
            description: form.description,
            system_prompt: form.system_prompt,
            model: form.model,
            temperature,
            tools: form.tools,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setFormError(body.detail ?? `Create failed (${res.status})`);
          return;
        }
      }
      closeForm();
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteAgent(agent: Agent) {
    if (!confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;
    await fetch(`${API_URL}/api/v1/agents/${agent.id}`, { method: "DELETE" });
    refresh();
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
          <span className="text-foreground">Agents</span>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-medium tracking-tight">Agent builder</h1>
            <p className="mt-1 text-sm text-muted">
              Configure the prompt, model, and tools each agent gets at runtime.
            </p>
          </div>
          {!formOpen && (
            <button
              onClick={openCreateForm}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              New agent
            </button>
          )}
        </div>
        {note && <p className="mt-3 font-mono text-xs text-muted">{note}</p>}

        {formOpen && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitForm();
            }}
            className="mt-6 space-y-3 rounded-lg border border-hairline p-4"
          >
            <h2 className="text-sm font-medium">
              {editingId ? "Edit agent" : "New agent"}
            </h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Name"
                required
                className={inputClass}
              />
              <input
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="slug (e.g. my-agent)"
                required
                disabled={!!editingId}
                className={inputClass}
              />
            </div>

            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Description"
              className={inputClass}
            />

            <textarea
              value={form.system_prompt}
              onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
              placeholder="System prompt"
              rows={5}
              required
              className={inputClass}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                placeholder="server default"
                className={inputClass}
              />
              <input
                type="number"
                step={0.1}
                min={0}
                max={2}
                value={form.temperature}
                onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))}
                placeholder="Temperature"
                className={inputClass}
              />
            </div>

            <div>
              <p className="mb-2 font-mono text-xs text-muted">tools</p>
              <div className="flex flex-wrap gap-3">
                {toolNames.map((name) => (
                  <label key={name} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={form.tools.includes(name)}
                      onChange={() => toggleTool(name)}
                    />
                    <span className="font-mono text-xs">{name}</span>
                  </label>
                ))}
                {toolNames.length === 0 && (
                  <span className="font-mono text-xs text-muted">no tools available</span>
                )}
              </div>
            </div>

            {formError && <p className="font-mono text-xs text-muted">⚠ {formError}</p>}

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
              >
                {busy ? "Saving…" : editingId ? "Save changes" : "Create agent"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-md border border-hairline px-4 py-2 text-sm text-muted hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <ul className="mt-6 space-y-3">
          {agents.map((a) => (
            <li key={a.id} className="rounded-lg border border-hairline p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{a.name}</span>
                    {a.is_builtin && (
                      <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] text-muted">
                        builtin
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-muted">
                    {a.slug} · {a.model}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => openEditForm(a)}
                    className="rounded-md border border-hairline px-3 py-1.5 text-xs text-muted hover:text-foreground"
                  >
                    Edit
                  </button>
                  {!a.is_builtin && (
                    <button
                      onClick={() => deleteAgent(a)}
                      className="rounded-md border border-hairline px-3 py-1.5 text-xs text-muted hover:text-foreground"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              {a.description && <p className="mt-2 text-sm text-muted">{a.description}</p>}
              {a.tools.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {a.tools.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-hairline px-2.5 py-0.5 font-mono text-[10px] text-muted"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
          {agents.length === 0 && !note && (
            <li className="pt-8 text-center text-sm text-muted">
              No agents yet — create one to give it a prompt, model, and tools.
            </li>
          )}
        </ul>
      </main>
    </div>
  );
}
