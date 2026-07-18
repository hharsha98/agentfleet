import { Reveal } from "./reveal";

// Honest, verifiable numbers — no invented metrics. Kept in one place so
// they're easy to audit against the actual test suites/agent registry.
const STATS: { value: string; label: string }[] = [
  { value: "9", label: "built-in agents" },
  { value: "2", label: "agent runtimes (LangGraph + Pydantic AI)" },
  { value: "106", label: "backend tests" },
  { value: "21", label: "E2E tests" },
  { value: "94ms", label: "p95 under load" },
];

export function StatsStrip() {
  return (
    <Reveal className="border-y border-hairline">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-6 px-6 py-8 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-8">
        {STATS.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-1">
            <span className="font-mono text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
              {stat.value}
            </span>
            <span className="text-xs text-muted">{stat.label}</span>
          </div>
        ))}
      </div>
    </Reveal>
  );
}
