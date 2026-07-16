"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { apiFetch } from "@/lib/api";

// Only used to render the curl example for the webhook trigger URL below —
// /api/v1/hooks/* is public (B1 gate excludes it, webhooks authenticate via
// their own per-webhook secret, not the user's session), so that one string
// build stays a plain API_URL reference rather than going through apiFetch.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type ScheduledRun = {
  id: string;
  name: string;
  goal: string;
  cron: string;
  enabled: boolean;
  last_run_at: string | null;
  created_at: string;
};

type Webhook = {
  id: string;
  name: string;
  goal_template: string;
  secret_prefix: string;
  last_triggered_at: string | null;
  created_at: string;
};

type WebhookCreated = Webhook & { trigger_path: string; secret: string };

const inputClass =
  "w-full rounded-md border border-hairline bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent disabled:opacity-50";

export default function AutomationsPage() {
  const [schedules, setSchedules] = useState<ScheduledRun[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [cron, setCron] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toggleBusy, setToggleBusy] = useState<Record<string, boolean>>({});
  const [deleteBusy, setDeleteBusy] = useState<Record<string, boolean>>({});

  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [whName, setWhName] = useState("");
  const [whGoal, setWhGoal] = useState("");
  const [whBusy, setWhBusy] = useState(false);
  const [whFormError, setWhFormError] = useState<string | null>(null);
  const [whDeleteBusy, setWhDeleteBusy] = useState<Record<string, boolean>>({});
  const [justCreated, setJustCreated] = useState<WebhookCreated | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      const res = await apiFetch("/api/v1/schedules");
      if (res.ok) {
        setSchedules(await res.json());
        setNote(null);
      } else {
        setNote("API offline — start the backend and reload.");
      }
    } catch {
      setNote("API offline — start the backend and reload.");
    }
  }

  async function refreshWebhooks() {
    try {
      const res = await apiFetch("/api/v1/webhooks");
      if (res.ok) setWebhooks(await res.json());
    } catch {
      // note already covers API-offline state via refresh()
    }
  }

  useEffect(() => {
    refresh();
    refreshWebhooks();
  }, []);

  async function createSchedule() {
    if (busy || !name.trim() || !goal.trim() || !cron.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await apiFetch("/api/v1/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), goal: goal.trim(), cron: cron.trim() }),
      });
      if (res.ok) {
        setName("");
        setGoal("");
        setCron("");
        refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        setFormError(body.detail ?? `Create failed (${res.status})`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(schedule: ScheduledRun) {
    if (toggleBusy[schedule.id]) return;
    setToggleBusy((b) => ({ ...b, [schedule.id]: true }));
    try {
      const res = await apiFetch(`/api/v1/schedules/${schedule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !schedule.enabled }),
      });
      if (res.ok) refresh();
    } finally {
      setToggleBusy((b) => ({ ...b, [schedule.id]: false }));
    }
  }

  async function deleteSchedule(schedule: ScheduledRun) {
    if (!confirm(`Delete automation "${schedule.name}"? This cannot be undone.`)) return;
    setDeleteBusy((b) => ({ ...b, [schedule.id]: true }));
    try {
      const res = await apiFetch(`/api/v1/schedules/${schedule.id}`, {
        method: "DELETE",
      });
      if (res.ok) refresh();
    } finally {
      setDeleteBusy((b) => ({ ...b, [schedule.id]: false }));
    }
  }

  async function createWebhook() {
    if (whBusy || !whName.trim() || !whGoal.trim()) return;
    setWhBusy(true);
    setWhFormError(null);
    try {
      const res = await apiFetch("/api/v1/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: whName.trim(), goal_template: whGoal.trim() }),
      });
      if (res.ok) {
        const created: WebhookCreated = await res.json();
        setJustCreated(created);
        setCopied(false);
        setWhName("");
        setWhGoal("");
        refreshWebhooks();
      } else {
        const body = await res.json().catch(() => ({}));
        setWhFormError(body.detail ?? `Create failed (${res.status})`);
      }
    } finally {
      setWhBusy(false);
    }
  }

  async function deleteWebhook(webhook: Webhook) {
    if (!confirm(`Delete webhook "${webhook.name}"? This cannot be undone.`)) return;
    setWhDeleteBusy((b) => ({ ...b, [webhook.id]: true }));
    try {
      const res = await apiFetch(`/api/v1/webhooks/${webhook.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (justCreated?.id === webhook.id) setJustCreated(null);
        refreshWebhooks();
      }
    } finally {
      setWhDeleteBusy((b) => ({ ...b, [webhook.id]: false }));
    }
  }

  function curlExample(webhook: WebhookCreated): string {
    // API_URL, not the web app's origin — /api/v1/hooks is served by the API.
    return `curl -X POST ${API_URL}${webhook.trigger_path} \\\n  -H "Authorization: Bearer ${webhook.secret}" \\\n  -d '{"payload":"..."}'`;
  }

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      // clipboard access denied — the mono box still shows the secret to copy manually
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
          <Link href="/templates" className="hover:text-foreground">
            Templates
          </Link>
          <Link href="/evals" className="hover:text-foreground">
            Evals
          </Link>
          <Link href="/usage" className="hover:text-foreground">
            Usage
          </Link>
          <span className="text-foreground">Automations</span>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Automations</h1>
          <p className="mt-1 text-sm text-muted">
            Give the fleet a goal and a schedule — the worker plans and runs a mission
            automatically, on repeat.
          </p>
        </div>
        {note && <p className="mt-3 font-mono text-xs text-muted">{note}</p>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            createSchedule();
          }}
          className="mt-6 space-y-3 rounded-lg border border-hairline p-4"
        >
          <h2 className="text-sm font-medium">New automation</h2>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Daily competitor scan)"
            required
            className={inputClass}
          />

          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Goal — the same kind of thing you'd type on the Missions page"
            rows={3}
            required
            className={inputClass}
          />

          <div>
            <input
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 9 * * *"
              required
              className={`${inputClass} font-mono`}
            />
            <p className="mt-1.5 font-mono text-[11px] text-muted">
              cron: min hour day month weekday — e.g. <code>0 9 * * *</code> = daily 09:00 UTC
            </p>
          </div>

          {formError && <p className="font-mono text-xs text-muted">⚠ {formError}</p>}

          <button
            type="submit"
            disabled={busy || !name.trim() || !goal.trim() || !cron.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </form>

        <p className="mt-4 font-mono text-[11px] text-muted">
          Schedules run on the worker (docker compose full stack / ORCHESTRATOR_MODE=arq).
        </p>

        <ul className="mt-6 space-y-3">
          {schedules.map((s) => (
            <li key={s.id} className="rounded-lg border border-hairline p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{s.name}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                        s.enabled
                          ? "border-emerald-400/40 text-emerald-300"
                          : "border-hairline text-muted"
                      }`}
                    >
                      {s.enabled ? "enabled" : "disabled"}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted">{s.goal}</p>
                  <p className="mt-1.5 font-mono text-[11px] text-muted">
                    {s.cron} · last run: {s.last_run_at ? new Date(s.last_run_at).toLocaleString() : "never"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => toggleEnabled(s)}
                    disabled={toggleBusy[s.id]}
                    className="rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-opacity hover:text-foreground disabled:opacity-40"
                  >
                    {s.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => deleteSchedule(s)}
                    disabled={deleteBusy[s.id]}
                    className="rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-opacity hover:text-foreground disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
          {schedules.length === 0 && !note && (
            <li>
              <EmptyState
                glyph="⏱"
                title="No automations yet"
                description="Create one above to run a goal on a schedule."
              />
            </li>
          )}
        </ul>

        <div className="mt-12">
          <h2 className="text-2xl font-medium tracking-tight">Webhooks</h2>
          <p className="mt-1 text-sm text-muted">
            Give the fleet a goal template — an external system POSTs to the trigger URL to run
            it on demand.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            createWebhook();
          }}
          className="mt-6 space-y-3 rounded-lg border border-hairline p-4"
        >
          <h2 className="text-sm font-medium">New webhook</h2>

          <input
            value={whName}
            onChange={(e) => setWhName(e.target.value)}
            placeholder="Name (e.g. Zendesk ticket triage)"
            required
            className={inputClass}
          />

          <div>
            <textarea
              value={whGoal}
              onChange={(e) => setWhGoal(e.target.value)}
              placeholder="Goal template — e.g. Triage this ticket: {payload}"
              rows={3}
              required
              className={inputClass}
            />
            <p className="mt-1.5 font-mono text-[11px] text-muted">
              use <code>{"{payload}"}</code> to inject the request body
            </p>
          </div>

          {whFormError && <p className="font-mono text-xs text-muted">⚠ {whFormError}</p>}

          <button
            type="submit"
            disabled={whBusy || !whName.trim() || !whGoal.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {whBusy ? "Creating…" : "Create"}
          </button>
        </form>

        {justCreated && (
          <div className="mt-4 space-y-2 rounded-lg border border-emerald-400/40 p-4">
            <p className="text-sm font-medium">
              Webhook created — copy the secret now, it won&apos;t be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-hairline bg-transparent px-3 py-2 font-mono text-xs">
                {justCreated.secret}
              </code>
              <button
                onClick={() => copySecret(justCreated.secret)}
                className="shrink-0 rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-opacity hover:text-foreground"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="font-mono text-[11px] text-muted">
              Trigger URL: <code>{justCreated.trigger_path}</code>
            </p>
            <pre className="overflow-x-auto rounded-md border border-hairline bg-transparent px-3 py-2 font-mono text-[11px] text-muted">
              {curlExample(justCreated)}
            </pre>
          </div>
        )}

        <ul className="mt-6 space-y-3">
          {webhooks.map((w) => (
            <li key={w.id} className="rounded-lg border border-hairline p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{w.name}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted">{w.goal_template}</p>
                  <p className="mt-1.5 font-mono text-[11px] text-muted">
                    /api/v1/hooks/{w.id}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-muted">
                    {w.secret_prefix}… · last triggered:{" "}
                    {w.last_triggered_at ? new Date(w.last_triggered_at).toLocaleString() : "never"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => deleteWebhook(w)}
                    disabled={whDeleteBusy[w.id]}
                    className="rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-opacity hover:text-foreground disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
          {webhooks.length === 0 && !note && (
            <li>
              <EmptyState
                glyph="🪝"
                title="No webhooks yet"
                description="Create one above to trigger a mission from an external system."
              />
            </li>
          )}
        </ul>
      </main>
    </div>
  );
}
