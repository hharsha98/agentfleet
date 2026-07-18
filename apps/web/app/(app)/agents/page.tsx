"use client";

import { useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { apiFetch } from "@/lib/api";

function RobotIcon({ className }: { className?: string }) {
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
      <rect x="4.5" y="8.5" width="15" height="10.5" rx="2.5" />
      <path d="M12 8.5V5M9.5 5h5" />
      <circle cx="9" cy="13.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13.5" r="1.1" fill="currentColor" stroke="none" />
      <path d="M9 16.5h6" />
    </svg>
  );
}

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

type AgentVersion = {
  id: string;
  version: number;
  note: string;
  created_at: string;
};

type RedTeamCaseResult = {
  case_id: string | null;
  input: string;
  passed: boolean;
  checks: { contains: boolean; forbidden: boolean; judge: boolean | null };
  judge_reason: string | null;
  reply_preview: string;
};

type RedTeamRun = {
  total: number;
  passed: number;
  results: RedTeamCaseResult[];
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
  "w-full rounded-md border border-hairline bg-transparent px-3 py-2 text-sm outline-none transition-colors duration-200 placeholder:text-muted focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";

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

  // Red-team (guardrails eval): busy flag, latest run per agent, and
  // whether the failed-cases list is expanded for that agent's card.
  const [redTeamBusy, setRedTeamBusy] = useState<Record<string, boolean>>({});
  const [redTeamByAgent, setRedTeamByAgent] = useState<Record<string, RedTeamRun | null>>({});
  const [redTeamExpanded, setRedTeamExpanded] = useState<Record<string, boolean>>({});

  // Versioning (Ops pillar): which agent's version history panel is
  // expanded, the versions loaded for it, the "publish" note input, busy
  // flags for publish/rollback, and a brief "restored" confirmation.
  const [versionsOpenId, setVersionsOpenId] = useState<string | null>(null);
  const [versionsByAgent, setVersionsByAgent] = useState<Record<string, AgentVersion[]>>({});
  const [publishNote, setPublishNote] = useState<Record<string, string>>({});
  const [publishBusy, setPublishBusy] = useState<Record<string, boolean>>({});
  const [rollbackBusy, setRollbackBusy] = useState<Record<string, boolean>>({});
  const [versionStatus, setVersionStatus] = useState<Record<string, string>>({});

  async function refresh() {
    try {
      const [agentsRes, toolsRes] = await Promise.all([
        apiFetch("/api/v1/agents"),
        apiFetch("/api/v1/agents/tools"),
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
        const res = await apiFetch(`/api/v1/agents/${editingId}`, {
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
        const res = await apiFetch("/api/v1/agents", {
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
    await apiFetch(`/api/v1/agents/${agent.id}`, { method: "DELETE" });
    refresh();
  }

  async function fetchKeys(agentId: string) {
    const res = await apiFetch(`/api/v1/agents/${agentId}/keys`);
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
      const res = await apiFetch(`/api/v1/agents/${agentId}/keys`, {
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
    await apiFetch(`/api/v1/agents/${agentId}/keys/${key.id}`, { method: "DELETE" });
    await fetchKeys(agentId);
  }

  async function copyKey(agentId: string, key: string) {
    await navigator.clipboard.writeText(key);
    setCopiedId(agentId);
    setTimeout(() => setCopiedId((id) => (id === agentId ? null : id)), 1500);
  }

  async function runRedTeam(agentId: string) {
    if (redTeamBusy[agentId]) return;
    setRedTeamBusy((b) => ({ ...b, [agentId]: true }));
    try {
      const res = await apiFetch(`/api/v1/agents/${agentId}/evals/red-team`, {
        method: "POST",
      });
      if (res.ok) {
        const data: RedTeamRun = await res.json();
        setRedTeamByAgent((r) => ({ ...r, [agentId]: data }));
        setRedTeamExpanded((e) => ({ ...e, [agentId]: false }));
      }
    } finally {
      setRedTeamBusy((b) => ({ ...b, [agentId]: false }));
    }
  }

  function toggleRedTeamExpanded(agentId: string) {
    setRedTeamExpanded((e) => ({ ...e, [agentId]: !e[agentId] }));
  }

  function failedRedTeamCases(agentId: string): RedTeamCaseResult[] {
    return (redTeamByAgent[agentId]?.results ?? []).filter((r) => !r.passed);
  }

  async function fetchVersions(agentId: string) {
    const res = await apiFetch(`/api/v1/agents/${agentId}/versions`);
    if (res.ok) {
      const data = await res.json();
      setVersionsByAgent((v) => ({ ...v, [agentId]: data }));
    }
  }

  function toggleVersions(agentId: string) {
    if (versionsOpenId === agentId) {
      setVersionsOpenId(null);
      return;
    }
    setVersionsOpenId(agentId);
    fetchVersions(agentId);
  }

  async function publishVersion(agentId: string) {
    if (publishBusy[agentId]) return;
    setPublishBusy((b) => ({ ...b, [agentId]: true }));
    try {
      const res = await apiFetch(`/api/v1/agents/${agentId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: publishNote[agentId]?.trim() || "" }),
      });
      if (res.ok) {
        setPublishNote((n) => ({ ...n, [agentId]: "" }));
        await fetchVersions(agentId);
      }
    } finally {
      setPublishBusy((b) => ({ ...b, [agentId]: false }));
    }
  }

  async function rollbackVersion(agentId: string, version: AgentVersion) {
    if (
      !confirm(
        `Roll back to v${version.version}? This restores that config and adds a new version.`
      )
    )
      return;
    setRollbackBusy((b) => ({ ...b, [agentId]: true }));
    try {
      const res = await apiFetch(
        `/api/v1/agents/${agentId}/versions/${version.id}/rollback`,
        { method: "POST" }
      );
      if (res.ok) {
        setVersionStatus((s) => ({ ...s, [agentId]: `Restored to v${version.version}` }));
        await Promise.all([refresh(), fetchVersions(agentId)]);
        setTimeout(() => {
          setVersionStatus((s) => ({ ...s, [agentId]: "" }));
        }, 3000);
      }
    } finally {
      setRollbackBusy((b) => ({ ...b, [agentId]: false }));
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Agent builder</h1>
          <p className="mt-1 text-sm text-muted">
            Configure the prompt, model, and tools each agent gets at runtime.
          </p>
        </div>
        {!formOpen && (
          <button
            onClick={openCreateForm}
            className="shrink-0 cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90"
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
                      className="shrink-0 cursor-pointer rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors duration-200 hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addMcpServer}
                  className="cursor-pointer rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors duration-200 hover:text-foreground"
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
                className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Saving…" : editingId ? "Save changes" : "Create agent"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="cursor-pointer rounded-md border border-hairline px-4 py-2 text-sm text-muted transition-colors duration-200 hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <ul className="mt-6 space-y-3">
          {agents.map((a) => (
            <li
              key={a.id}
              className="rounded-lg border border-hairline p-4 transition-colors duration-200 hover:border-accent/30"
            >
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
                    className="cursor-pointer rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors duration-200 hover:text-foreground"
                  >
                    Edit
                  </button>
                  {!a.is_builtin && (
                    <button
                      onClick={() => deleteAgent(a)}
                      className="cursor-pointer rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors duration-200 hover:text-foreground"
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

              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => toggleKeys(a.id)}
                  className="cursor-pointer text-xs text-muted transition-colors duration-200 hover:text-foreground"
                >
                  {keysOpenId === a.id ? "Hide API keys" : "API keys"}
                </button>
                <button
                  onClick={() => runRedTeam(a.id)}
                  disabled={redTeamBusy[a.id]}
                  className="rounded-md border border-hairline px-2.5 py-1 text-[11px] text-muted transition-opacity hover:text-foreground disabled:opacity-40"
                >
                  {redTeamBusy[a.id] ? "Running red-team…" : "Red-team"}
                </button>
                <button
                  onClick={() => toggleVersions(a.id)}
                  className="cursor-pointer text-xs text-muted transition-colors duration-200 hover:text-foreground"
                >
                  {versionsOpenId === a.id ? "Hide versions" : "Versions"}
                </button>
              </div>

              {redTeamByAgent[a.id] && (
                <div className="mt-2 rounded-md border border-hairline p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-mono ${
                        redTeamByAgent[a.id]!.passed === redTeamByAgent[a.id]!.total
                          ? "text-emerald-300"
                          : "text-red-300"
                      }`}
                    >
                      Injection resistance: {redTeamByAgent[a.id]!.passed}/
                      {redTeamByAgent[a.id]!.total}
                    </span>
                    {failedRedTeamCases(a.id).length > 0 && (
                      <button
                        onClick={() => toggleRedTeamExpanded(a.id)}
                        className="shrink-0 cursor-pointer text-[11px] text-muted transition-colors duration-200 hover:text-foreground"
                      >
                        {redTeamExpanded[a.id]
                          ? "Hide failed"
                          : `Show failed (${failedRedTeamCases(a.id).length})`}
                      </button>
                    )}
                  </div>
                  {redTeamExpanded[a.id] && failedRedTeamCases(a.id).length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {failedRedTeamCases(a.id).map((r, i) => (
                        <li key={i} className="text-muted">
                          {r.input}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

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
                          className="shrink-0 cursor-pointer rounded-md border border-hairline px-2.5 py-1 text-[11px] text-muted transition-colors duration-200 hover:text-foreground"
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
                          className="shrink-0 cursor-pointer rounded-md border border-hairline px-2 py-1 text-[11px] text-muted transition-colors duration-200 hover:text-foreground"
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

              {versionsOpenId === a.id && (
                <div className="mt-3 space-y-3 rounded-md border border-hairline p-3">
                  <div className="flex gap-2">
                    <input
                      value={publishNote[a.id] ?? ""}
                      onChange={(e) =>
                        setPublishNote((n) => ({ ...n, [a.id]: e.target.value }))
                      }
                      placeholder="release note (optional)"
                      className={`${inputClass} py-1.5`}
                    />
                    <button
                      onClick={() => publishVersion(a.id)}
                      disabled={publishBusy[a.id]}
                      className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
                    >
                      {publishBusy[a.id] ? "Publishing…" : "Publish current"}
                    </button>
                  </div>

                  {versionStatus[a.id] && (
                    <p className="font-mono text-xs text-muted">{versionStatus[a.id]}</p>
                  )}

                  <ul className="space-y-2">
                    {(versionsByAgent[a.id] ?? []).map((v) => (
                      <li
                        key={v.id}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <span className="font-mono">v{v.version}</span>{" "}
                          <span>{v.note || "—"}</span>{" "}
                          <span className="font-mono text-muted">
                            {new Date(v.created_at).toLocaleString()}
                          </span>
                        </div>
                        <button
                          onClick={() => rollbackVersion(a.id, v)}
                          disabled={rollbackBusy[a.id]}
                          className="shrink-0 rounded-md border border-hairline px-2.5 py-1 text-[11px] text-muted hover:text-foreground disabled:opacity-40"
                        >
                          Roll back
                        </button>
                      </li>
                    ))}
                    {(versionsByAgent[a.id] ?? []).length === 0 && (
                      <li className="text-xs text-muted">No versions yet.</li>
                    )}
                  </ul>
                </div>
              )}
            </li>
          ))}
          {agents.length === 0 && !note && (
            <li>
              <EmptyState
                glyph={<RobotIcon className="h-7 w-7" />}
                title="No agents yet"
                description="Create one above to give it a prompt, model, and tools."
              />
            </li>
          )}
        </ul>
    </main>
  );
}
