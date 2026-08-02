"use client";

import { useEffect, useMemo, useState } from "react";

import { BarChart } from "@/components/dash/bar-chart";
import { Panel } from "@/components/dash/panel";
import { StatCard } from "@/components/dash/stat-card";
import { Icon } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/reveal";
import { PageHeader } from "@/components/page-header";
import { Term } from "@/components/term";
import { apiFetch } from "@/lib/api";

type Agent = {
  id: string;
  slug: string;
  name: string;
};

type UsageToday = {
  tokens: number;
  cost_usd: number;
  messages: number;
  // Count of today's assistant messages whose model app/costs.py doesn't
  // recognize -- cost_usd above under-counts by whatever those messages
  // actually cost, so the UI surfaces this instead of a bare (misleadingly
  // confident-looking) dollar figure.
  unpriced_messages: number;
};

type UsagePerAgent = {
  agent_slug: string;
  agent_name: string;
  tokens: number;
  cost_usd: number;
  messages: number;
};

type UsageSummary = {
  today: UsageToday;
  per_agent: UsagePerAgent[];
};

type UsageDaily = {
  date: string;
  tokens: number;
  cost_usd: number;
};

type Budget = {
  id: string;
  agent_id: string | null;
  agent_slug: string | null;
  daily_token_limit: number | null;
  daily_usd_limit: number | null;
};

type BudgetRow = {
  key: string;
  agentId: string | null;
  label: string;
  budget: Budget | null;
};

const inputClass =
  "w-24 rounded-md border border-hairline bg-transparent px-2 py-1 text-xs font-mono outline-none transition-colors duration-200 placeholder:text-muted focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";

function fmtInt(n: number): string {
  return n.toLocaleString();
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

export default function UsagePage() {
  const [note, setNote] = useState<string | null>(null);

  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [daily, setDaily] = useState<UsageDaily[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [chartMetric, setChartMetric] = useState<"tokens" | "cost">("tokens");

  const [pendingAgentIds, setPendingAgentIds] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, { token: string; usd: string }>>({});
  const [addAgentId, setAddAgentId] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function refreshSummary() {
    const res = await apiFetch("/api/v1/usage/summary");
    if (res.ok) setSummary(await res.json());
  }

  async function refreshDaily() {
    const res = await apiFetch("/api/v1/usage/daily?days=14");
    if (res.ok) setDaily(await res.json());
  }

  async function refreshBudgets() {
    const res = await apiFetch("/api/v1/budgets");
    if (res.ok) setBudgets(await res.json());
  }

  async function refreshAgents() {
    const res = await apiFetch("/api/v1/agents");
    if (res.ok) setAgents(await res.json());
  }

  async function refreshAll() {
    try {
      await Promise.all([refreshSummary(), refreshDaily(), refreshBudgets(), refreshAgents()]);
      setNote(null);
    } catch {
      setNote("API offline — start the backend and reload.");
    }
  }

  useEffect(() => {
    // refreshAll() is async and only calls setState (via the four refresh*
    // helpers above) after their own `await apiFetch(...)` resolves —
    // nothing is set synchronously here, so this is the fetch-on-mount
    // idiom, not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const globalBudget = budgets.find((b) => b.agent_id === null) ?? null;
  const agentBudgets = budgets.filter((b) => b.agent_id !== null);
  const budgetedAgentIds = new Set(agentBudgets.map((b) => b.agent_id));

  const rows: BudgetRow[] = [
    { key: "global", agentId: null, label: "Global", budget: globalBudget },
    ...agentBudgets.map((b) => ({
      key: b.agent_id as string,
      agentId: b.agent_id,
      label: b.agent_slug ?? (b.agent_id as string),
      budget: b,
    })),
    ...pendingAgentIds.map((id) => ({
      key: id,
      agentId: id,
      label: agents.find((a) => a.id === id)?.slug ?? id,
      budget: null,
    })),
  ];

  const availableAgents = agents.filter(
    (a) => !budgetedAgentIds.has(a.id) && !pendingAgentIds.includes(a.id),
  );

  function currentToken(row: BudgetRow): string {
    if (edits[row.key]?.token !== undefined) return edits[row.key].token;
    return row.budget?.daily_token_limit != null ? String(row.budget.daily_token_limit) : "";
  }

  function currentUsd(row: BudgetRow): string {
    if (edits[row.key]?.usd !== undefined) return edits[row.key].usd;
    return row.budget?.daily_usd_limit != null ? String(row.budget.daily_usd_limit) : "";
  }

  function setTokenEdit(row: BudgetRow, value: string) {
    setEdits((prev) => ({ ...prev, [row.key]: { token: value, usd: currentUsd(row) } }));
  }

  function setUsdEdit(row: BudgetRow, value: string) {
    setEdits((prev) => ({ ...prev, [row.key]: { token: currentToken(row), usd: value } }));
  }

  function clearRowEdits(key: string) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function putBudget(
    row: BudgetRow,
    dailyTokenLimit: number | null,
    dailyUsdLimit: number | null,
  ) {
    setBusyKey(row.key);
    try {
      const res = await apiFetch("/api/v1/budgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: row.agentId,
          daily_token_limit: dailyTokenLimit,
          daily_usd_limit: dailyUsdLimit,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setNote(body.detail ?? `Save failed (${res.status})`);
        return;
      }
      clearRowEdits(row.key);
      if (row.agentId) setPendingAgentIds((ids) => ids.filter((id) => id !== row.agentId));
      await refreshBudgets();
    } finally {
      setBusyKey(null);
    }
  }

  function saveBudget(row: BudgetRow) {
    const tokenStr = currentToken(row).trim();
    const usdStr = currentUsd(row).trim();
    putBudget(row, tokenStr === "" ? null : Number(tokenStr), usdStr === "" ? null : Number(usdStr));
  }

  function addAgentRow() {
    if (!addAgentId) return;
    setPendingAgentIds((ids) => [...ids, addAgentId]);
    setAddAgentId("");
  }

  // Stat row figures — all derived straight from /usage/summary, no
  // fabricated aggregates. per_agent is scoped to the last 7 days by the
  // backend (see routes/usage.py), so the 7-day cost/tokens/active-agents
  // stats reuse that same window honestly rather than inventing a separate
  // aggregate.
  const sevenDayCost = useMemo(
    () => (summary ? summary.per_agent.reduce((sum, a) => sum + a.cost_usd, 0) : 0),
    [summary],
  );
  const sevenDayTokens = useMemo(
    () => (summary ? summary.per_agent.reduce((sum, a) => sum + a.tokens, 0) : 0),
    [summary],
  );
  const activeAgents = summary?.per_agent.length ?? 0;

  const chartData = daily.map((d) => ({
    label: d.date.slice(5),
    value: chartMetric === "tokens" ? d.tokens : d.cost_usd,
    tooltip:
      chartMetric === "tokens"
        ? `${d.date}: ${fmtInt(d.tokens)} tokens`
        : `${d.date}: ${fmtUsd(d.cost_usd)}`,
  }));

  const maxAgentCost = Math.max(1e-9, ...(summary?.per_agent.map((a) => a.cost_usd) ?? [0]));

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Icon name="gauge" />}
        hue="blue"
        title="Usage & cost"
        description="Every token, call, and cent — metered per agent and per day. Set budgets so an agent can never overspend."
      >
        {summary && (
          <span className="font-mono text-xs text-muted">
            {fmtUsd(summary.today.cost_usd)} modeled today
          </span>
        )}
      </PageHeader>
      {note && <p className="mt-3 font-mono text-xs text-muted">{note}</p>}

      {/* Stat row */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Modeled cost (list price)"
          value={summary ? fmtUsd(summary.today.cost_usd) : "—"}
          sub={
            summary
              ? summary.today.unpriced_messages > 0
                ? `${fmtInt(summary.today.messages)} messages \u00b7 ${fmtInt(summary.today.unpriced_messages)} from unpriced models`
                : `${fmtInt(summary.today.messages)} messages`
              : undefined
          }
          icon={<Icon name="gauge" />}
          hue="blue"
          pulse
          delay={0}
        />
        <StatCard
          label="Cost (7d)"
          value={summary ? fmtUsd(sevenDayCost) : "—"}
          icon={<Icon name="activity" />}
          hue="violet"
          delay={40}
        />
        <StatCard
          label="Tokens (7d)"
          value={summary ? fmtInt(sevenDayTokens) : "—"}
          icon={<Icon name="sparkle" />}
          hue="cyan"
          delay={80}
        />
        <StatCard
          label="Active agents (7d)"
          value={summary ? activeAgents : "—"}
          icon={<Icon name="workflow" />}
          hue="green"
          delay={120}
        />
      </div>

      {/* Daily chart */}
      <div className="mt-4">
        <Panel
          title="Last 14 days"
          action={
            <div className="flex gap-1 rounded-md border border-hairline p-0.5 text-xs">
              {(["tokens", "cost"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setChartMetric(m)}
                  className={`cursor-pointer rounded px-2.5 py-1 capitalize transition-colors duration-200 ${
                    chartMetric === m ? "bg-accent text-white" : "text-muted hover:text-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          }
          delay={0}
          hue="blue"
        >
          <BarChart
            data={chartData}
            hue={chartMetric === "tokens" ? "blue" : "violet"}
            title={`Daily ${chartMetric} over the last 14 days`}
            desc="One bar per day; hover a bar for its exact value."
            height={160}
            valueFormatter={(v) => (chartMetric === "tokens" ? fmtInt(v) : fmtUsd(v))}
            emptyLabel="No usage yet."
          />
        </Panel>
      </div>

      {/* Per-agent table */}
      <div className="mt-4">
        <Panel title="Per agent (last 7 days)" delay={40} hue="blue">
          {/* Sits OUTSIDE the overflow-x-auto wrapper below on purpose: that
              wrapper computes overflow-y to auto as well, which would clip
              the Term tooltip against a short table. */}
          <p className="mb-3 max-w-3xl text-xs leading-relaxed text-muted">
            <Term k="tokens">Tokens</Term>{" "}
            here is ↑ in plus ↓ out added together — the prompt the agent was handed and the reply
            it wrote back, counted as one number. Cost is what those tokens actually billed at that
            model&apos;s rate, so a chatty cheap model and a terse expensive one are comparable on
            this column and not on the last.
          </p>
          <div className="overflow-x-auto rounded-lg border border-hairline">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-muted">
                  <th className="px-3 py-2 font-normal">Agent</th>
                  <th className="px-3 py-2 font-normal">Tokens</th>
                  <th className="px-3 py-2 font-normal">Cost</th>
                  <th className="px-3 py-2 font-normal">Messages</th>
                </tr>
              </thead>
              <tbody>
                {summary?.per_agent.map((a) => {
                  const pct = Math.min(100, (a.cost_usd / maxAgentCost) * 100);
                  return (
                    <tr
                      key={a.agent_slug}
                      className="border-b border-hairline transition-colors duration-200 last:border-0 hover:bg-white/[0.02]"
                      style={{
                        backgroundImage: `linear-gradient(to right, color-mix(in srgb, var(--hue-blue) 16%, transparent) ${pct}%, transparent ${pct}%)`,
                      }}
                    >
                      <td className="px-3 py-2">{a.agent_name}</td>
                      <td className="px-3 py-2 font-mono">{fmtInt(a.tokens)}</td>
                      <td className="px-3 py-2 font-mono">{fmtUsd(a.cost_usd)}</td>
                      <td className="px-3 py-2 font-mono">{fmtInt(a.messages)}</td>
                    </tr>
                  );
                })}
                {(!summary || summary.per_agent.length === 0) && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted">
                      No usage in the last 7 days.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* Budgets */}
      <div className="mt-4">
        <Panel
          title="Budgets"
          description="Daily caps — once hit, the agent replies with a budget message instead of calling the model."
          delay={80}
          hue="blue"
        >
          <p className="mb-3 max-w-3xl text-xs leading-relaxed text-muted">
            Leave a box blank for no cap. Before each reply the backend adds up the{" "}
            <Term k="tokens">tokens</Term>{" "}
            and dollars that agent has already spent since midnight UTC and checks them against
            two rows: the agent&apos;s own, then <span className="text-foreground">Global</span>.
            If either is already at or past its number the turn never reaches the model, so an
            agent stuck in a loop costs you the reply it was on and nothing after it. The tally
            resets at midnight UTC.
          </p>
          <div className="space-y-2">
            {rows.map((row, i) => (
              <Reveal
                key={row.key}
                delay={i * 40}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline p-3 transition-colors duration-200 hover:border-accent/30"
              >
                <span className="w-32 shrink-0 text-sm">{row.label}</span>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  tokens
                  <input
                    value={currentToken(row)}
                    onChange={(e) => setTokenEdit(row, e.target.value)}
                    placeholder="none"
                    inputMode="numeric"
                    className={inputClass}
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  USD
                  <input
                    value={currentUsd(row)}
                    onChange={(e) => setUsdEdit(row, e.target.value)}
                    placeholder="none"
                    inputMode="decimal"
                    className={inputClass}
                  />
                </label>
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => saveBudget(row)}
                    disabled={busyKey === row.key}
                    className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyKey === row.key ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => putBudget(row, null, null)}
                    disabled={busyKey === row.key}
                    className="cursor-pointer rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors duration-200 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Clear
                  </button>
                </div>
              </Reveal>
            ))}
          </div>

          {availableAgents.length > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-hairline p-3">
              <select
                value={addAgentId}
                onChange={(e) => setAddAgentId(e.target.value)}
                className="rounded-md border border-hairline bg-transparent px-3 py-1.5 text-sm outline-none transition-colors duration-200 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
              >
                <option value="">Add a budget for…</option>
                {availableAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.slug})
                  </option>
                ))}
              </select>
              <button
                onClick={addAgentRow}
                disabled={!addAgentId}
                className="cursor-pointer rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors duration-200 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add
              </button>
            </div>
          )}
        </Panel>
      </div>
    </main>
  );
}
