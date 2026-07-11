import { Reveal } from "./reveal";

const OPS_ITEMS = [
  {
    tag: "LLM-as-judge · CI gate",
    title: "Eval Center",
    description:
      "Score every change against a rubric and block regressions before they ship.",
  },
  {
    tag: "budgets · routing",
    title: "Cost governance",
    description:
      "Per-agent budgets, hard caps, and automatic model routing to keep spend predictable.",
  },
  {
    tag: "PII masking · red-team",
    title: "Guardrails",
    description:
      "Prompt-injection screening, PII masking, and a red-team suite run on every agent.",
  },
  {
    tag: "one-click rollback",
    title: "Versioned publishing",
    description:
      "Every publish is a version. Roll back a bad deploy in one click.",
  },
];

export function OpsLayer() {
  return (
    <div className="flex flex-col gap-10">
      <Reveal className="flex flex-col gap-3">
        <span className="font-mono text-xs text-muted">THE OPS LAYER</span>
        <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
          Production controls, not a demo.
        </h2>
        <p className="max-w-xl text-muted">
          Most agent demos stop at a chat window. AgentFleet ships with the
          governance layer that makes agents safe to run in production.
        </p>
      </Reveal>

      <div className="grid grid-cols-1 gap-x-8 gap-y-8 md:grid-cols-2">
        {OPS_ITEMS.map((item, i) => (
          <Reveal
            key={item.title}
            delay={i * 80}
            className="flex flex-col gap-2 border-t border-hairline pt-4"
          >
            <span className="font-mono text-xs text-accent">{item.tag}</span>
            <h3 className="font-medium tracking-tight text-foreground">
              {item.title}
            </h3>
            <p className="text-sm text-muted">{item.description}</p>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
