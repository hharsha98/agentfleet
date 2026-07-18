import Link from "next/link";

import { FeatureGrid } from "@/components/landing/feature-grid";
import { HeroTrace } from "@/components/landing/hero-trace";
import { OpsLayer } from "@/components/landing/ops-layer";
import { StatsStrip } from "@/components/landing/stats-strip";
import { UserMenu } from "@/components/user-menu";

const GITHUB_URL = "https://github.com/hharsha98/agentfleet";

const STACK = [
  "FastAPI",
  "LangGraph",
  "Postgres + pgvector",
  "fastembed",
  "Next.js",
  "Auth.js",
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
      {/* Page-scoped ambient background: layered accent-tinted glows + an
          ultra-subtle dot texture. Fixed so it reads as one continuous
          backdrop behind every section, not a per-section decoration. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-32 left-1/4 h-[32rem] w-[32rem] rounded-full bg-accent/10 blur-[120px]" />
        <div className="absolute top-1/3 right-0 h-[28rem] w-[28rem] rounded-full bg-hue-violet/10 blur-[120px]" />
        <div className="absolute bottom-0 left-1/2 h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-hue-cyan/10 blur-[120px]" />
        <div className="bg-dot-texture absolute inset-0 opacity-[0.03]" />
      </div>

      <header className="sticky top-0 z-50 border-b border-hairline bg-background/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/" className="font-medium tracking-tight">
            AgentFleet
          </Link>

          <nav className="hidden items-center gap-6 font-mono text-xs text-muted sm:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="cursor-pointer transition-colors duration-200 hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener"
              className="cursor-pointer transition-colors duration-200 hover:text-foreground"
            >
              GitHub
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <UserMenu />
            {/* Hidden on phones: the hero CTA covers this journey there, and
                the header must not crowd the wordmark at 375px. */}
            <Link
              href="/chat"
              className="hidden cursor-pointer rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 sm:inline-flex"
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

          <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 px-6 py-20 sm:py-28 lg:grid-cols-2 lg:py-32">
            <div className="flex flex-col items-start gap-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-hairline px-3 py-1 font-mono text-xs text-muted">
                  OPEN SOURCE · SELF-HOSTABLE
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1 font-mono text-xs text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-hue-green animate-pulse-soft" />
                  9 built-in agents
                </span>
              </div>

              <h1 className="text-4xl font-medium tracking-tight sm:text-5xl lg:text-6xl">
                <span className="block text-foreground">
                  The operations platform
                </span>
                <span className="block bg-gradient-to-r from-accent via-hue-violet to-hue-cyan bg-clip-text text-transparent">
                  for AI agents, orchestrated.
                </span>
              </h1>

              <p className="max-w-md text-muted">
                Multi-agent chat, goal-to-Kanban orchestration, evals, cost
                governance, and guardrails — self-hosted, in one fleet.
              </p>

              <div className="flex flex-wrap items-center gap-5">
                <Link
                  href="/chat"
                  className="group inline-flex cursor-pointer items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-[0_8px_30px_-8px_rgba(94,106,210,0.6)] transition-all duration-200 hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[0_12px_36px_-8px_rgba(94,106,210,0.75)]"
                >
                  Launch the fleet
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                    aria-hidden
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
                <Link
                  href="/changelog"
                  className="cursor-pointer text-sm font-medium text-muted underline underline-offset-4 transition-colors duration-200 hover:text-foreground"
                >
                  View changelog
                </Link>
              </div>
            </div>

            <HeroTrace />
          </div>
        </section>

        {/* STATS STRIP */}
        <StatsStrip />

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

        {/* STACK ROW */}
        <section className="border-y border-hairline">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-8">
            <span className="font-mono text-xs tracking-[0.2em] text-muted">
              STACK
            </span>
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 font-mono text-xs tracking-wide text-muted">
              {STACK.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
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
                  className="cursor-pointer rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-[0_8px_30px_-8px_rgba(94,106,210,0.6)] transition-all duration-200 hover:-translate-y-0.5 hover:opacity-90"
                >
                  Launch the fleet →
                </Link>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener"
                  className="cursor-pointer text-sm font-medium text-muted underline underline-offset-4 transition-colors duration-200 hover:text-foreground"
                >
                  Read the docs
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-10 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-sm text-muted">Built by Harsha · MIT licensed</p>
          <nav className="flex items-center gap-5 font-mono text-xs text-muted">
            <Link
              href="/changelog"
              className="cursor-pointer transition-colors duration-200 hover:text-foreground"
            >
              Changelog
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener"
              className="cursor-pointer transition-colors duration-200 hover:text-foreground"
            >
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </>
  );
}
