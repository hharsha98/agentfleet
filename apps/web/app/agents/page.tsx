"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type McpServer = {
  name: string;
  url: string;
};

type Agent = {
  id: string;
  slug: string;
  name: string;
  description: string;
  model: string;
  system_prompt: string;
  temperature: number;
  tools: string[];
  mcp_servers: McpServer[];
  is_builtin: boolean;
};

type ApiKeyItem = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
};

type FormState = {
  name: string;
  slug: string;
  description: string;
  system_prompt: string;
  model: string;
  temperature: string;
  tools: string[];
  mcp_servers: McpServer[];
};

const EMPTY_FORM: FormState = {
  name: "",
  slug: "",
  description: "",
  system_prompt: "",
  model: "",
  temperature: "0.7",
  tools: [],
  mcp_servers: [],
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

  // API keys (Publish pillar): which agent's keys panel is expanded, the
  // keys loaded for it, the "create key" mini-form input, and the
  // full key shown exactly once right after creation.
  const [keysOpenId, setKeysOpenId] = useState<string | null>(null);
  const [keysByAgent, setKeysByAgent] = useState<Record<string, ApiKeyItem[]>>({});
  const [newKeyName, setNewKeyName] = useState<Record<string, string>>({});
  const [keyBusy, setKeyBusy] = useState<Record<string, boolean>>({});
  const [revealedKey, setRevealedKey] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
      mcp_servers: agent.mcp_servers,
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

  function addMcpServer() {
    setForm((f) => ({ ...f, mcp_servers: [...f.mcp_servers, { name: "", url: "" }] }));
  }

  function updateMcpServer(index: number, field: "name" | "url", value: string) {
    setForm((f) => ({
      ...f,
      mcp_servers: f.mcp_servers.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    }));
  }

  function removeMcpServer(index: number) {
    setForm((f) => ({ ...f, mcp_servers: f.mcp_servers.filter((_, i) => i !== index) }));
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
            mcp_servers: form.mcp_servers,
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
            mcp_servers: form.mcp_servers,
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

  async function fetchKeys(agentId: string) {
    const res = await fetch(`${API_URL}/api/v1/agents/${agentId}/keys`);
    if (res.ok) {
      const data = await res.json();
      setKeysByAgent((k) => ({ ...k, [agentId]: data }));
    }
  }

  function toggleKeys(agentId: string) {
    if (keysOpenId === agentId) {
      setKeysOpenId(null);
      return;
    }
    setKeysOpenId(agentId);
    setRevealedKey((r) => {
      const next = { ...r };
      delete next[agentId];
      return next;
    });
    fetchKeys(agentId);
  }

  async function createKey(agentId: string) {
    if (keyBusy[agentId]) return;
    setKeyBusy((b) => ({ ...b, [agentId]: true }));
    try {
      const res = await fetch(`${API_URL}/api/v1/agents/${agentId}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName[agentId]?.trim() || "default" }),
      });
      if (res.ok) {
        const body = await res.json();
        setRevealedKey((r) => ({ ...r, [agentId]: body.key }));
        setNewKeyName((n) => ({ ...n, [agentId]: "" }));
        await fetchKeys(agentId);
      }
    } finally {
      setKeyBusy((b) => ({ ...b, [agentId]: false }));
    }
  }

  async function revokeKey(agentId: string, key: ApiKeyItem) {
    if (!confirm(`Revoke key "${key.name}" (${key.prefix}…)? This cannot be undone.`)) return;
    await fetch(`${API_URL}/api/v1/agents/${agentId}/keys/${key.id}`, { method: "DELETE" });
    await fetchKeys(agentId);
  }

  async function copyKey(agentId: string, key: string) {
    await navigator.clipboard.writeText(key);
    setCopiedId(agentId);
    setTimeout(() => setCopiedId((id) => (id === agentId ? null : id)), 1500);
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
          <Link href="/templates" className="hover:text-foreground">
            Templates
          </Link>
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

            <div>
              <p className="mb-2 font-mono text-xs text-muted">mcp servers</p>
              <div className="space-y-2">
                {form.mcp_servers.map((server, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={server.name}
                      onChange={(e) => updateMcpServer(i, "name", e.target.value)}
                      placeholder="name (e.g. search)"
                      className={inputClass}
                    />
                    <input
                      value={server.url}
                      onChange={(e) => updateMcpServer(i, "url", e.target.value)}
                      placeholder="https://…"
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => removeMcpServer(i)}
                      className="shrink-0 rounded-md border border-hairline px-3 py-2 text-xs text-muted hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addMcpServer}
                  className="rounded-md border border-hairline px-3 py-1.5 text-xs text-muted hover:text-foreground"
                >
                  Add server
                </button>
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
              {(a.tools.length > 0 || a.mcp_servers.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {a.tools.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-hairline px-2.5 py-0.5 font-mono text-[10px] text-muted"
                    >
                      {t}
                    </span>
                  ))}
                  {a.mcp_servers.map((s) => (
                    <span
                      key={s.name}
                      className="rounded-full border border-hairline px-2.5 py-0.5 font-mono text-[10px] text-muted"
                    >
                      mcp:{s.name}
                    </span>
                  ))}
                </div>
              )}

              <button
                onClick={() => toggleKeys(a.id)}
                className="mt-3 text-xs text-muted hover:text-foreground"
              >
                {keysOpenId === a.id ? "Hide API keys" : "API keys"}
              </button>

              {keysOpenId === a.id && (
                <div className="mt-3 space-y-3 rounded-md border border-hairline p-3">
                  <ul className="space-y-2">
                    {(keysByAgent[a.id] ?? []).map((k) => (
                      <li
                        key={k.id}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <span className="font-medium">{k.name}</span>{" "}
                          <span className="font-mono text-muted">{k.prefix}…</span>
                          <span className="ml-2 text-muted">
                            created {new Date(k.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <button
                          onClick={() => revokeKey(a.id, k)}
                          className="shrink-0 rounded-md border border-hairline px-2.5 py-1 text-[11px] text-muted hover:text-foreground"
                        >
                          Revoke
                        </button>
                      </li>
                    ))}
                    {(keysByAgent[a.id] ?? []).length === 0 && (
                      <li className="text-xs text-muted">No keys yet.</li>
                    )}
                  </ul>

                  {revealedKey[a.id] && (
                    <div className="space-y-1.5 rounded-md bg-accent/10 p-2.5">
                      <div className="flex items-center justify-between gap-2 font-mono text-xs">
                        <span className="truncate">{revealedKey[a.id]}</span>
                        <button
                          onClick={() => copyKey(a.id, revealedKey[a.id])}
                          className="shrink-0 rounded-md border border-hairline px-2 py-1 text-[11px] text-muted hover:text-foreground"
                        >
                          {copiedId === a.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <p className="text-[11px] text-muted">
                        Copy now — shown only once.
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <input
                      value={newKeyName[a.id] ?? ""}
                      onChange={(e) =>
                        setNewKeyName((n) => ({ ...n, [a.id]: e.target.value }))
                      }
                      placeholder="key name"
                      className={`${inputClass} py-1.5`}
                    />
                    <button
                      onClick={() => createKey(a.id)}
                      disabled={keyBusy[a.id]}
                      className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
                    >
                      {keyBusy[a.id] ? "Creating…" : "Create key"}
                    </button>
                  </div>
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
