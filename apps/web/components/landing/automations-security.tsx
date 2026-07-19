import Link from "next/link";

import { IconTile } from "./icons";
import { Reveal } from "./reveal";

// Facts backing this section's copy (kept honest, no invented numbers):
// - Scheduled runs: apps/api/app/routes/schedules.py + services/scheduler.py
//   (is_due/poll_due_schedules), arq cron polls every minute (docs/PRODUCTION_PLAN.md
//   "Phase 10 I (scheduled runs half) DONE").
// - Webhooks: Webhook model, hash-only secret, /api/v1/webhooks CRUD +
//   /api/v1/hooks/{id} bearer-auth trigger (docs/PRODUCTION_PLAN.md "Phase 10 I
//   FULLY DONE (schedules + webhooks)").
// - Google SSO: Auth.js v5 (docs/DEMO.md: "Auth is Google OAuth via Auth.js v5").
// - Rate limiting: slowapi, per-user/per-IP, 3 routes (ARCHITECTURE.md "Rate
//   limiting (Phase 12 C)").
// - Readiness probes: apps/api/app/main.py has GET /health and GET /health/ready.

function CronVignette() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-hairline bg-black/20 p-3 font-mono text-[11px] text-muted">
      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-hue-blue/30">
        <span className="animate-pulse-node absolute inset-0 rounded-full bg-hue-blue/15" />
        <span className="relative h-2 w-[1.5px] -translate-y-1 bg-hue-blue" />
      </span>
      <span>Runs every minute · next in 0:42</span>
    </div>
  );
}

function ShieldVignette() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-hairline bg-black/20 p-3 font-mono text-[11px] text-muted">
      <span className="animate-pulse-node h-1.5 w-1.5 rounded-full bg-hue-green" />
      <span>Google SSO · rate-limited · /health/ready</span>
    </div>
  );
}

export function AutomationsSecurity() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Reveal className="rounded-xl border border-hairline">
          <Link
            href="/automations"
            aria-label="Open automations"
            className="flex cursor-pointer flex-col gap-4 rounded-xl p-6 transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div className="flex items-center gap-3">
              <IconTile icon="clock" hue="blue" />
              <span className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-hue-blue">
                Automations
              </span>
            </div>
            <h3 className="font-medium tracking-tight text-foreground">
              Runs while you sleep
            </h3>
            <p className="text-sm text-muted">
              Schedule a goal on a cron and it runs unattended, or trigger a
              run from an inbound webhook. Both live in one /automations
              screen next to the runs they create.
            </p>
            <CronVignette />
          </Link>
        </Reveal>

        <Reveal delay={80} className="rounded-xl border border-hairline">
          <Link
            href="/changelog"
            aria-label="View security changelog"
            className="flex cursor-pointer flex-col gap-4 rounded-xl p-6 transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div className="flex items-center gap-3">
              <IconTile icon="shield" hue="green" />
              <span className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-hue-green">
                Security
              </span>
            </div>
            <h3 className="font-medium tracking-tight text-foreground">
              Enterprise-grade foundation
            </h3>
            <p className="text-sm text-muted">
              Google SSO for sign-in, every request scoped to its own user,
              and rate limits on chat, uploads, and the public API. A
              readiness probe checks the database before traffic is routed in.
            </p>
            <ShieldVignette />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
