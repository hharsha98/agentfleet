"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { apiFetch } from "@/lib/api";

const inputClass =
  "w-full rounded-md border border-hairline bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent disabled:opacity-50";

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

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-hairline px-6 py-3">
        <Link href="/" className="font-medium tracking-tight">
          AgentFleet
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm text-muted">
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
          <Link href="/automations" className="hover:text-foreground">
            Automations
          </Link>
          <span className="text-foreground">Playground</span>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-medium tracking-tight">Prompt Playground</h1>
        <p className="mt-1 text-sm text-muted">
          Run the same prompt against two model/temperature configs side by side, compare cost
          and latency, and save the pair as a reusable experiment.
        </p>
        {note && <p className="mt-3 font-mono text-xs text-muted">{note}</p>}

        <datalist id="playground-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>

        <div className="mt-6 space-y-3">
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
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {variantA.loading || variantB.loading ? "Running…" : "Run both"}
          </button>
          <button
            onClick={saveExperiment}
            disabled={!canSave}
            className="rounded-md border border-hairline px-4 py-2 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-40"
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

        <h2 className="mt-10 text-sm font-medium">Saved experiments</h2>
        <ul className="mt-3 space-y-2">
          {experiments.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => loadExperiment(e.id)}
                className="flex w-full items-center justify-between rounded-lg border border-hairline px-4 py-3 text-left text-sm transition-colors hover:border-accent"
              >
                <span>{e.title}</span>
                <span className="font-mono text-xs text-muted">
                  {e.models.join(" vs ")} · {new Date(e.created_at).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
          {experiments.length === 0 && (
            <li>
              <EmptyState
                glyph="⚗️"
                title="No experiments saved yet"
                description="Run both variants above, then click Save experiment to keep the comparison for later."
              />
            </li>
          )}
        </ul>
      </main>
    </div>
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
    <div className="flex flex-col gap-3 rounded-lg border border-hairline p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted">Variant {label}</span>
        {agents.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onLoadAgent(e.target.value);
              e.target.value = "";
            }}
            className="rounded-md border border-hairline bg-transparent px-2 py-1 text-xs text-muted outline-none focus:border-accent"
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
