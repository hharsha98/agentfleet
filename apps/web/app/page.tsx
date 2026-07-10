import { ApiStatus } from "@/components/api-status";
import { UserMenu } from "@/components/user-menu";

export default function Home() {
  return (
    <>
      <header className="flex items-center justify-between border-b border-hairline px-6 py-3">
        <span className="font-medium tracking-tight">AgentFleet</span>
        <UserMenu />
      </header>
      <main className="relative flex flex-1 flex-col items-center justify-center gap-6 overflow-hidden px-6">
      {/* Blueprint grid + single radial glow — hero only, per design spec */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--hairline)_1px,transparent_1px),linear-gradient(to_bottom,var(--hairline)_1px,transparent_1px)] bg-[size:32px_32px] opacity-40"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-accent opacity-20 blur-3xl"
      />

      <h1 className="relative text-5xl font-medium tracking-tight">AgentFleet</h1>
      <p className="relative max-w-md text-center text-muted">
        A multi-agent operations platform — orchestrate, evaluate, and ship AI
        agents with production-grade guardrails.
      </p>
      <ApiStatus />
      </main>
    </>
  );
}
