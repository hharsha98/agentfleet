"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Panel } from "@/components/dash/panel";
import { StatCard } from "@/components/dash/stat-card";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/reveal";
import { MicButton } from "@/components/mic-button";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api";

function FlaskIcon({ className }: { className?: string }) {
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
      <path d="M9.5 3.5h5M10 3.5v6.2L5.6 17c-.7 1.3.2 2.9 1.7 2.9h9.4c1.5 0 2.4-1.6 1.7-2.9L14 9.7V3.5" />
      <path d="M7.5 15h9" />
    </svg>
  );
}

type Agent = {
  id: string;
  slug: string;
  name: string;
};

type EvalCase = {
  id: string;
  agent_id: string;
  input: string;
  expected_contains: string[];
  forbidden_contains: string[];
  judge_rubric: string;
  created_at: string;
};

type CaseChecks = {
  contains: boolean;
  forbidden: boolean;
  judge: boolean | null;
};

type CaseResult = {
  case_id: string;
  input: string;
  passed: boolean;
  checks: CaseChecks;
  judge_reason: string | null;
  reply_preview: string;
};

type EvalRun = {
  id: string;
  agent_id: string;
  total: number;
  passed: number;
  results: CaseResult[];
  created_at: string;
};

type EvalRunSummary = {
  id: string;
  total: number;
  passed: number;
  created_at: string;
};

type CaseFormState = {
  input: string;
  expected_contains: string;
  forbidden_contains: string;
  judge_rubric: string;
};

const EMPTY_CASE_FORM: CaseFormState = {
  input: "",
  expected_contains: "",
  forbidden_contains: "",
  judge_rubric: "",
};

const inputClass =
  "w-full rounded-md border border-hairline bg-transparent px-3 py-2 text-sm outline-none transition-colors duration-200 placeholder:text-muted focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function EvalsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [note, setNote] = useState<string | null>(null);

  const [cases, setCases] = useState<EvalCase[]>([]);
  const [totalCases, setTotalCases] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CaseFormState>(EMPTY_CASE_FORM);
  const [caseBusy, setCaseBusy] = useState(false);
  const [caseError, setCaseError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [latestRun, setLatestRun] = useState<EvalRun | null>(null);
  const [recentRuns, setRecentRuns] = useState<EvalRunSummary[]>([]);
  const [totalRuns, setTotalRuns] = useState<number | null>(null);

  async function refreshAgents() {
    try {
      const res = await apiFetch("/api/v1/agents");
      if (res.ok) {
        const data: Agent[] = await res.json();
        setAgents(data);
        if (!agentId && data.length > 0) setAgentId(data[0].id);
        setNote(null);
      } else {
        setNote("API offline — start the backend and reload.");
      }
    } catch {
      setNote("API offline — start the backend and reload.");
    }
  }

  useEffect(() => {
    refreshAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshCases() {
    if (!agentId) return;
    const res = await apiFetch(`/api/v1/agents/${agentId}/evals/cases`);
    if (res.ok) {
      setCases(await res.json());
      const total = res.headers.get("X-Total-Count");
      setTotalCases(total ? Number(total) : null);
    }
  }

  async function refreshRuns() {
    if (!agentId) return;
    const res = await apiFetch(`/api/v1/agents/${agentId}/evals/runs?limit=50`);
    if (res.ok) {
      setRecentRuns(await res.json());
      const total = res.headers.get("X-Total-Count");
      setTotalRuns(total ? Number(total) : null);
    }
  }

  useEffect(() => {
    setLatestRun(null);
    setFormOpen(false);
    setCaseError(null);
    if (agentId) {
      refreshCases();
      refreshRuns();
    } else {
      setCases([]);
      setRecentRuns([]);
      setTotalCases(null);
      setTotalRuns(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function createCase() {
    if (caseBusy || !agentId) return;
    if (!form.input.trim()) {
      setCaseError("Input is required.");
      return;
    }
    setCaseBusy(true);
    setCaseError(null);
    try {
      const res = await apiFetch(`/api/v1/agents/${agentId}/evals/cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: form.input,
          expected_contains: splitCsv(form.expected_contains),
          forbidden_contains: splitCsv(form.forbidden_contains),
          judge_rubric: form.judge_rubric.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCaseError(body.detail ?? `Create failed (${res.status})`);
        return;
      }
      setForm(EMPTY_CASE_FORM);
      setFormOpen(false);
      await refreshCases();
    } finally {
      setCaseBusy(false);
    }
  }

  async function deleteCase(caseId: string) {
    if (!agentId) return;
    if (!confirm("Delete this eval case? This cannot be undone.")) return;
    await apiFetch(`/api/v1/agents/${agentId}/evals/cases/${caseId}`, {
      method: "DELETE",
    });
    await refreshCases();
  }

  async function runEvals() {
    if (running || !agentId) return;
    setRunning(true);
    try {
      const res = await apiFetch(`/api/v1/agents/${agentId}/evals/run`, {
        method: "POST",
      });
      if (res.ok) {
        setLatestRun(await res.json());
        await refreshRuns();
      } else {
        const body = await res.json().catch(() => ({}));
        setNote(body.detail ?? `Run failed (${res.status})`);
      }
    } finally {
      setRunning(false);
    }
  }

  // Stat row — all computed for the selected agent from endpoints already
  // on this page. recentRuns[0] is the most recent recorded run (backend
  // orders by created_at desc), refreshed right after a run completes, so
  // it reflects a just-finished run without waiting on latestRun's shape.
  const caseCount = totalCases ?? cases.length;
  const runCount = totalRuns ?? recentRuns.length;
  const lastRun = recentRuns[0] ?? null;
  const lastRunPassRate = lastRun && lastRun.total > 0 ? lastRun.passed / lastRun.total : null;

  const runTimeline = useMemo(() => recentRuns.slice(0, 12), [recentRuns]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Icon name="list-checks" />}
        hue="red"
        title="Eval Center"
        description="Every agent has a test suite. Add golden cases, run them as a regression gate, and let CI block prompt changes that break behavior."
      />
      {note && <p className="mt-3 font-mono text-xs text-muted">{note}</p>}

      <div className="mt-6">
        <label className="mb-1.5 block font-mono text-xs text-muted">agent</label>
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className={`${inputClass} sm:max-w-sm`}
        >
          {agents.length === 0 && <option value="">No agents yet</option>}
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.slug})
            </option>
          ))}
        </select>
      </div>

      {agentId && (
        <>
          {/* Stat row */}
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard
              label="Total cases"
              value={caseCount}
              icon={<Icon name="list-checks" />}
              hue="red"
              delay={0}
            />
            <StatCard
              label="Last run pass rate"
              value={lastRunPassRate !== null ? `${Math.round(lastRunPassRate * 100)}%` : "—"}
              sub={lastRun ? `${lastRun.passed}/${lastRun.total} cases` : "no runs yet"}
              icon={<Icon name="shield" />}
              hue={lastRunPassRate === null ? "blue" : lastRunPassRate === 1 ? "green" : "amber"}
              delay={40}
            />
            <StatCard
              label="Runs recorded"
              value={runCount}
              icon={<Icon name="clock" />}
              hue="violet"
              delay={80}
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Panel
              title="Eval cases"
              action={
                <div className="flex gap-2">
                  {!formOpen && (
                    <button
                      onClick={() => setFormOpen(true)}
                      className="cursor-pointer rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors duration-200 hover:text-foreground"
                    >
                      Add case
                    </button>
                  )}
                  <button
                    onClick={runEvals}
                    disabled={running || cases.length === 0}
                    className="cursor-pointer rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {running ? "Running…" : "Run evals"}
                  </button>
                </div>
              }
              delay={0}
            >
              {formOpen && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    createCase();
                  }}
                  className="mb-3 space-y-3 rounded-lg border border-hairline p-4"
                >
                  <div className="relative">
                    <textarea
                      value={form.input}
                      onChange={(e) => setForm((f) => ({ ...f, input: e.target.value }))}
                      placeholder="Input the agent will receive"
                      rows={3}
                      required
                      className={inputClass}
                    />
                    <MicButton
                      className="absolute bottom-2 right-2 py-1"
                      onTranscript={(t) =>
                        setForm((f) => ({ ...f, input: f.input ? f.input + " " + t : t }))
                      }
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      value={form.expected_contains}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, expected_contains: e.target.value }))
                      }
                      placeholder="expected substrings, comma separated"
                      className={inputClass}
                    />
                    <input
                      value={form.forbidden_contains}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, forbidden_contains: e.target.value }))
                      }
                      placeholder="forbidden substrings, comma separated"
                      className={inputClass}
                    />
                  </div>
                  <textarea
                    value={form.judge_rubric}
                    onChange={(e) => setForm((f) => ({ ...f, judge_rubric: e.target.value }))}
                    placeholder="optional: LLM-judge rubric (leave blank to skip judging)"
                    rows={2}
                    className={inputClass}
                  />
                  {caseError && <p className="font-mono text-xs text-muted">⚠ {caseError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={caseBusy}
                      className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {caseBusy ? "Saving…" : "Add case"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFormOpen(false);
                        setForm(EMPTY_CASE_FORM);
                        setCaseError(null);
                      }}
                      className="cursor-pointer rounded-md border border-hairline px-4 py-2 text-sm text-muted transition-colors duration-200 hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              <ul className="space-y-2">
                {cases.map((c, i) => (
                  <li key={c.id}>
                    <Reveal
                      delay={i * 40}
                      className="rounded-lg border border-hairline p-3 transition-colors duration-200 hover:border-accent/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm">
                          {c.input.length > 140 ? `${c.input.slice(0, 140)}…` : c.input}
                        </p>
                        <div className="flex shrink-0 items-center gap-2">
                          {c.judge_rubric && (
                            <span className="rounded-full border border-accent/40 px-2 py-0.5 font-mono text-[10px] text-accent">
                              judged
                            </span>
                          )}
                          <button
                            onClick={() => deleteCase(c.id)}
                            className="cursor-pointer rounded-md border border-hairline px-2.5 py-1 text-[11px] text-muted transition-colors duration-200 hover:text-foreground"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      {(c.expected_contains.length > 0 || c.forbidden_contains.length > 0) && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {c.expected_contains.map((s) => (
                            <span
                              key={`e-${s}`}
                              className="rounded-full border border-emerald-400/40 px-2 py-0.5 font-mono text-[10px] text-emerald-300"
                            >
                              + {s}
                            </span>
                          ))}
                          {c.forbidden_contains.map((s) => (
                            <span
                              key={`f-${s}`}
                              className="rounded-full border border-red-400/40 px-2 py-0.5 font-mono text-[10px] text-red-300"
                            >
                              − {s}
                            </span>
                          ))}
                        </div>
                      )}
                    </Reveal>
                  </li>
                ))}
                {cases.length === 0 && (
                  <li>
                    <EmptyState
                      glyph={<FlaskIcon className="h-7 w-7" />}
                      title="No eval cases yet"
                      description="Add one above to build this agent's regression suite."
                    />
                  </li>
                )}
              </ul>
            </Panel>

            <Panel
              title="Run history"
              description="Every recorded run for this agent, newest first."
              delay={40}
            >
              {runTimeline.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">No runs recorded yet.</p>
              ) : (
                <ol className="space-y-0">
                  {runTimeline.map((r, i) => {
                    const allPassed = r.passed === r.total;
                    const dotHue = allPassed ? "bg-hue-green" : r.passed === 0 ? "bg-hue-red" : "bg-hue-amber";
                    return (
                      <li key={r.id} className="relative flex gap-3 pb-4 last:pb-0">
                        {i < runTimeline.length - 1 && (
                          <span
                            aria-hidden="true"
                            className="absolute left-[5px] top-3 h-full w-px bg-hairline"
                          />
                        )}
                        <span
                          aria-hidden="true"
                          className={`relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotHue}`}
                        />
                        <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <span
                            className={`font-mono text-xs ${
                              allPassed ? "text-emerald-300" : r.passed === 0 ? "text-red-300" : "text-amber-300"
                            }`}
                          >
                            {r.passed}/{r.total} passed
                          </span>
                          <span className="text-[11px] text-muted">
                            {new Date(r.created_at).toLocaleString()}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Panel>
          </div>

          {latestRun && (
            <div className="mt-4">
              <Panel title="Latest run detail" delay={0}>
                <div className="flex items-baseline gap-3 rounded-lg border border-hairline p-4">
                  <span
                    className={`font-mono text-2xl font-medium ${
                      latestRun.passed === latestRun.total ? "text-emerald-300" : "text-red-300"
                    }`}
                  >
                    {latestRun.passed}/{latestRun.total}
                  </span>
                  <span className="text-sm text-muted">cases passed</span>
                </div>

                <ul className="mt-3 space-y-2">
                  {latestRun.results.map((r) => (
                    <li
                      key={r.case_id}
                      className={`rounded-lg border p-3 ${
                        r.passed ? "border-emerald-400/30" : "border-red-400/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm">
                          {r.input.length > 140 ? `${r.input.slice(0, 140)}…` : r.input}
                        </p>
                        <span
                          className={`shrink-0 font-mono text-xs ${
                            r.passed ? "text-emerald-300" : "text-red-300"
                          }`}
                        >
                          {r.passed ? "PASS" : "FAIL"}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] text-muted">
                        <span className={r.checks.contains ? "text-emerald-300" : "text-red-300"}>
                          contains {r.checks.contains ? "✓" : "✗"}
                        </span>
                        <span className={r.checks.forbidden ? "text-emerald-300" : "text-red-300"}>
                          forbidden {r.checks.forbidden ? "✓" : "✗"}
                        </span>
                        {r.checks.judge !== null && (
                          <span className={r.checks.judge ? "text-emerald-300" : "text-red-300"}>
                            judge {r.checks.judge ? "✓" : "✗"}
                          </span>
                        )}
                      </div>
                      {r.judge_reason && (
                        <p className="mt-2 text-xs text-muted">{r.judge_reason}</p>
                      )}
                      <details className="mt-2">
                        <summary className="cursor-pointer font-mono text-[10px] text-muted">
                          reply
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted">
                          {r.reply_preview}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          )}
        </>
      )}

      {/* The guardrails sandbox used to live here as a trailing panel. It now
          has its own page, which the landing page's "Guardrails" pillar links
          to — this pointer keeps the path discoverable from Evals. */}
      <p className="mt-4 text-sm text-muted">
        Looking for injection screening and PII masking?{" "}
        <Link
          href="/guardrails"
          className="cursor-pointer text-accent transition-opacity duration-200 hover:opacity-80"
        >
          Open the Guardrails sandbox
        </Link>
        .
      </p>
    </main>
  );
}
