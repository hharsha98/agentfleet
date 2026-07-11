import Link from "next/link";

import { FeatureGrid } from "@/components/landing/feature-grid";
import { HeroTrace } from "@/components/landing/hero-trace";
import { OpsLayer } from "@/components/landing/ops-layer";
import { UserMenu } from "@/components/user-menu";

const GITHUB_URL = "https://github.com/hharsha98/agentfleet";

const STACK = [
  "FastAPI",
  "LangGraph",
  "Postgres + pgvector",
  "Redis",
  "Next.js",
  "Langfuse",
  "MCP",
  "Docker",
  "Kubernetes",
];

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#ops", label: "Ops" },
];

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-50 border-b border-hairline bg-background/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/" className="font-medium tracking-tight">
            AgentFleet
          </Link>

          <nav className="hidden items-center gap-6 font-mono text-xs text-muted sm:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="hover:text-foreground">
                {link.label}
              </a>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener"
              className="hover:text-foreground"
            >
              GitHub
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <UserMenu />
            <Link
              href="/chat"
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Launch app
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* HERO */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--hairline)_1px,transparent_1px),linear-gradient(to_bottom,var(--hairline)_1px,transparent_1px)] bg-[size:32px_32px] opacity-[0.12]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-accent opacity-20 blur-3xl"
          />

          <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 px-6 py-20 sm:py-28 lg:grid-cols-2 lg:py-32">
            <div className="flex flex-col items-start gap-6">
              <span className="inline-flex items-center rounded-full border border-hairline px-3 py-1 font-mono text-xs text-muted">
                OPEN SOURCE · SELF-HOSTABLE
              </span>

              <h1 className="text-4xl font-medium tracking-tight sm:text-5xl lg:text-6xl">
                The operations platform
                <br />
                for AI agents. Orchestrate,
                <br />
                evaluate, and ship.
              </h1>

              <p className="max-w-md text-muted">
                Multi-agent chat, goal-to-Kanban orchestration, evals, cost
                governance, and guardrails — all self-hosted, all in one
                fleet.
              </p>

              <div className="flex flex-wrap items-center gap-5">
                <Link
                  href="/chat"
                  className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
                >
                  Launch the fleet →
                </Link>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener"
                  className="text-sm font-medium text-muted underline underline-offset-4 transition-colors hover:text-foreground"
                >
                  View source
                </a>
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted">
                <span>12 agents</span>
                <span>·</span>
                <span className="text-accent">31 tests green</span>
                <span>·</span>
                <span>MIT</span>
              </div>
            </div>

            <HeroTrace />
          </div>
        </section>

        {/* STACK WALL */}
        <section className="border-y border-hairline">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 py-6 font-mono text-xs text-muted">
            {STACK.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </section>

        {/* BENTO FEATURES GRID */}
        <section id="features" className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-12 flex flex-col gap-3">
            <span className="font-mono text-xs text-muted">FEATURES</span>
            <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
              Six pillars, one fleet.
            </h2>
          </div>
          <FeatureGrid />
        </section>

        {/* OPS LAYER */}
        <section id="ops" className="mx-auto max-w-6xl px-6 py-24">
          <OpsLayer />
        </section>

        {/* FINAL CTA */}
        <section className="mx-auto max-w-6xl px-6 py-24">
          <div className="relative overflow-hidden rounded-xl border border-hairline p-12 text-center">
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-accent opacity-20 blur-3xl"
            />
            <div className="relative flex flex-col items-center gap-6">
              <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
                Ready to run your own fleet?
              </h2>
              <p className="max-w-md text-muted">
                Self-host it in an afternoon. MIT licensed, docker-composed,
                ready to extend.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-5">
                <Link
                  href="/chat"
                  className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
                >
                  Launch the fleet →
                </Link>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener"
                  className="text-sm font-medium text-muted underline underline-offset-4 transition-colors hover:text-foreground"
                >
                  Read the docs
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="font-medium tracking-tight">AgentFleet</span>
            <p className="text-sm text-muted">
              Built as a portfolio project —{" "}
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener"
                className="underline underline-offset-4 hover:text-foreground"
              >
                GitHub repo
              </a>
              . MIT licensed.
            </p>
          </div>

          <nav className="flex items-center gap-4 font-mono text-xs text-muted">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="hover:text-foreground">
                {link.label}
              </a>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener"
              className="hover:text-foreground"
            >
              GitHub
            </a>
            <span>v0.1.0</span>
          </nav>
        </div>
      </footer>
    </>
  );
}
