"use client";

import { useEffect, useMemo, useState } from "react";

import { Panel } from "@/components/dash/panel";
import { StatCard } from "@/components/dash/stat-card";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/reveal";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api";

const inputClass =
  "w-full rounded-md border border-hairline bg-transparent px-3 py-2 text-sm outline-none transition-colors duration-200 placeholder:text-muted focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";

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

type Usage = {
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
};

type VariantState = {
  model: string;
  temperature: number;
  output: string;
  usage: Usage | null;
  error: string | null;
  loading: boolean;
};

const EMPTY_VARIANT_A: VariantState = {
  model: "",
  temperature: 0.7,
  output: "",
  usage: null,
  error: null,
  loading: false,
};

const EMPTY_VARIANT_B: VariantState = {
  model: "",
  temperature: 0.9,
  output: "",
  usage: null,
  error: null,
  loading: false,
};

type AgentOption = {
  id: string;
  slug: string;
  name: string;
  model: string;
  system_prompt: string;
};

type ExperimentSummary = {
  id: string;
  title: string;
  created_at: string;
  models: string[];
};

type ExperimentDetail = {
  id: string;
  title: string;
  system_prompt: string;
  user_message: string;
  variant_a: { model: string; temperature: number; output: string; usage: Usage };
  variant_b: { model: string; temperature: number; output: string; usage: Usage };
  created_at: string;
};

export default function PlaygroundPage() {
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [variantA, setVariantA] = useState<VariantState>(EMPTY_VARIANT_A);
  const [variantB, setVariantB] = useState<VariantState>(EMPTY_VARIANT_B);
  const [models, setModels] = useState<string[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [note, setNote] = useState<string | null>(null);

  async function refreshAll() {
    try {
      const [modelsRes, agentsRes, experimentsRes] = await Promise.all([
        apiFetch("/api/v1/playground/models"),
        apiFetch("/api/v1/agents"),
        apiFetch("/api/v1/playground/experiments"),
      ]);
      if (modelsRes.ok) setModels((await modelsRes.json()).models);
      if (agentsRes.ok) setAgents(await agentsRes.json());
      if (experimentsRes.ok) setExperiments(await experimentsRes.json());
    } catch {
      setNote("API offline — start the backend and reload.");
    }
  }

  useEffect(() => {
    refreshAll();
  }, []);

  async function runVariant(target: "a" | "b") {
    const variant = target === "a" ? variantA : variantB;
    const setVariant = target === "a" ? setVariantA : setVariantB;
    if (!variant.model.trim() || !userMessage.trim()) return;
    setVariant((v) => ({ ...v, loading: true, error: null }));
    try {
      const res = await apiFetch("/api/v1/playground/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_prompt: systemPrompt,
          user_message: userMessage,
          model: variant.model,
          temperature: variant.temperature,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setVariant((v) => ({
          ...v,
          loading: false,
          error: body.detail ?? `Request failed (${res.status})`,
        }));
        return;
      }
      setVariant((v) => ({
        ...v,
        loading: false,
        error: null,
        output: body.output,
        usage: body.usage,
      }));
    } catch (err) {
      setVariant((v) => ({ ...v, loading: false, error: String(err) }));
    }
  }

  // Fired in parallel — each variant tracks its own loading/error, so one
  // variant's provider failure never blocks or clears the other's result.
  function runBoth() {
    if (!userMessage.trim()) return;
    runVariant("a");
    runVariant("b");
  }

  function loadFromAgent(target: "a" | "b", agentId: string) {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;
    setSystemPrompt(agent.system_prompt);
    const setVariant = target === "a" ? setVariantA : setVariantB;
    setVariant((v) => ({ ...v, model: agent.model }));
  }

  async function saveExperiment() {
    if (!variantA.output || !variantB.output || !variantA.usage || !variantB.usage) return;
    const defaultTitle = userMessage.trim().slice(0, 60) || "Untitled experiment";
    const title = window.prompt("Experiment title", defaultTitle);
    if (!title) return;
    try {
      const res = await apiFetch("/api/v1/playground/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          system_prompt: systemPrompt,
          user_message: userMessage,
          variant_a: {
            model: variantA.model,
            temperature: variantA.temperature,
            output: variantA.output,
            usage: variantA.usage,
          },
          variant_b: {
            model: variantB.model,
            temperature: variantB.temperature,
            output: variantB.output,
            usage: variantB.usage,
          },
        }),
      });
      const body = await res.json();
      setNote(res.ok ? "✓ Experiment saved" : `⚠ ${body.detail ?? "save failed"}`);
      if (res.ok) refreshAll();
    } catch (err) {
      setNote(`⚠ ${String(err)}`);
    }
  }

  async function loadExperiment(id: string) {
    try {
      const res = await apiFetch(`/api/v1/playground/experiments/${id}`);
      if (!res.ok) return;
      const body: ExperimentDetail = await res.json();
      setSystemPrompt(body.system_prompt);
      setUserMessage(body.user_message);
      setVariantA({
        model: body.variant_a.model,
        temperature: body.variant_a.temperature,
        output: body.variant_a.output,
        usage: body.variant_a.usage,
        error: null,
        loading: false,
      });
      setVariantB({
        model: body.variant_b.model,
        temperature: body.variant_b.temperature,
        output: body.variant_b.output,
        usage: body.variant_b.usage,
        error: null,
        loading: false,
      });
      setNote(`Loaded "${body.title}"`);
    } catch (err) {
      setNote(`⚠ ${String(err)}`);
    }
  }

  const canRun = userMessage.trim() && variantA.model.trim() && variantB.model.trim();
  const canSave = variantA.output && variantB.output && !variantA.loading && !variantB.loading;

  // Chunk D3 stat row — derived purely from the already-fetched experiments
  // list (plus the model comparison it records), no new endpoints. "Last
  // experiment" is honestly a save time, not a "last run" — the API has no
  // endpoint tracking ad-hoc unsaved runs, only saved experiments.
  const comparedModels = useMemo(
    () => Array.from(new Set(experiments.flatMap((e) => e.models))),
    [experiments],
  );
  const lastExperimentAt = useMemo(
    () =>
      experiments.reduce<string | null>(
        (latest, e) => (!latest || e.created_at > latest ? e.created_at : latest),
        null,
      ),
    [experiments],
  );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Icon name="git-branch" />}
        hue="cyan"
        title="Prompt Playground"
        description="Run one prompt against two models side by side — compare answers, speed, and cost, then save the experiment."
      />
      {note && <p className="mt-3 font-mono text-xs text-muted">{note}</p>}

      <datalist id="playground-models">
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      {/* Stat row */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Experiments saved"
          value={experiments.length}
          icon={<Icon name="list-checks" />}
          hue="cyan"
        />
        <StatCard
          label="Models compared"
          value={comparedModels.length}
          sub={comparedModels.length > 0 ? comparedModels.join(", ") : "No experiments yet"}
          icon={<Icon name="git-branch" />}
          hue="violet"
          delay={40}
        />
        <StatCard
          label="Last experiment"
          value={lastExperimentAt ? new Date(lastExperimentAt).toLocaleDateString() : "—"}
          sub={lastExperimentAt ? new Date(lastExperimentAt).toLocaleTimeString() : undefined}
          icon={<Icon name="clock" />}
          hue="amber"
          delay={80}
        />
      </div>

      <Panel
        title="A/B comparison workbench"
        description="Run one prompt against two models side by side — compare answers, speed, and cost."
        className="mt-6"
        delay={40}
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block font-mono text-xs text-muted">system prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Optional — shared by both variants"
              rows={3}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-xs text-muted">user message</label>
            <textarea
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              placeholder="What should both variants respond to?"
              rows={3}
              className={inputClass}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={runBoth}
            disabled={!canRun || variantA.loading || variantB.loading}
            className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {variantA.loading || variantB.loading ? "Running…" : "Run both"}
          </button>
          <button
            onClick={saveExperiment}
            disabled={!canSave}
            className="cursor-pointer rounded-md border border-hairline px-4 py-2 text-sm text-muted transition-colors duration-200 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save experiment
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <VariantPanel
            label="A"
            variant={variantA}
            agents={agents}
            onModel={(model) => setVariantA((v) => ({ ...v, model }))}
            onTemperature={(temperature) => setVariantA((v) => ({ ...v, temperature }))}
            onLoadAgent={(agentId) => loadFromAgent("a", agentId)}
          />
          <VariantPanel
            label="B"
            variant={variantB}
            agents={agents}
            onModel={(model) => setVariantB((v) => ({ ...v, model }))}
            onTemperature={(temperature) => setVariantB((v) => ({ ...v, temperature }))}
            onLoadAgent={(agentId) => loadFromAgent("b", agentId)}
          />
        </div>
      </Panel>

      <Panel
        title="Recent experiments"
        description="Click one to reload its prompt, variants, and outputs."
        className="mt-4"
        delay={80}
      >
        <ul className="space-y-2">
          {experiments.map((e, i) => (
            <li key={e.id}>
              <Reveal delay={i * 40}>
                <button
                  onClick={() => loadExperiment(e.id)}
                  className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline px-4 py-3 text-left text-sm transition-colors duration-200 hover:border-accent"
                >
                  <span>{e.title}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {e.models.map((m, mi) => (
                      <span
                        key={mi}
                        className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] text-muted"
                      >
                        {m}
                      </span>
                    ))}
                    <span className="font-mono text-xs text-muted">
                      {new Date(e.created_at).toLocaleString()}
                    </span>
                  </span>
                </button>
              </Reveal>
            </li>
          ))}
          {experiments.length === 0 && (
            <li>
              <EmptyState
                glyph={<FlaskIcon className="h-7 w-7" />}
                title="No experiments saved yet"
                description="Run both variants above, then click Save experiment to keep the comparison for later."
              />
            </li>
          )}
        </ul>
      </Panel>
    </main>
  );
}

function VariantPanel({
  label,
  variant,
  agents,
  onModel,
  onTemperature,
  onLoadAgent,
}: {
  label: string;
  variant: VariantState;
  agents: AgentOption[];
  onModel: (model: string) => void;
  onTemperature: (temperature: number) => void;
  onLoadAgent: (agentId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline p-4 transition-colors duration-200 hover:border-accent/30">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted">Variant {label}</span>
        {agents.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onLoadAgent(e.target.value);
              e.target.value = "";
            }}
            className="cursor-pointer rounded-md border border-hairline bg-transparent px-2 py-1 text-xs text-muted outline-none transition-colors duration-200 focus:border-accent"
          >
            <option value="">Load from agent ▾</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.slug})
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          value={variant.model}
          onChange={(e) => onModel(e.target.value)}
          list="playground-models"
          placeholder="model"
          className={inputClass}
        />
        <input
          type="number"
          step={0.1}
          min={0}
          max={2}
          value={variant.temperature}
          onChange={(e) => onTemperature(Number(e.target.value))}
          className={inputClass}
        />
      </div>

      <div className="min-h-[8rem] whitespace-pre-wrap rounded-md border border-hairline bg-black/10 px-3 py-2 text-sm leading-relaxed">
        {variant.loading && <span className="text-muted">Running…</span>}
        {!variant.loading && variant.error && <span className="text-red-400">⚠ {variant.error}</span>}
        {!variant.loading && !variant.error && variant.output}
        {!variant.loading && !variant.error && !variant.output && (
          <span className="text-muted">No output yet.</span>
        )}
      </div>

      {variant.usage && !variant.error && (
        <div className="border-t border-hairline pt-1 font-mono text-[10px] text-muted">
          ↑{variant.usage.tokens_in} ↓{variant.usage.tokens_out} tok · {variant.usage.latency_ms}
          ms · ${variant.usage.cost_usd.toFixed(4)}
        </div>
      )}
    </div>
  );
}
