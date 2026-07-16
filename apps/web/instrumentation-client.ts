/**
 * Client-side observability entry point — Next.js 16's
 * `instrumentation-client.ts` file convention. Runs after the HTML document
 * loads but before React hydration. See
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md.
 *
 * Gated on NEXT_PUBLIC_SENTRY_DSN — blank (the default; no DSN exists in
 * this environment) means this file does nothing at all: @sentry/nextjs is
 * only pulled in via dynamic import when a DSN is actually configured, so
 * it adds no weight to the client bundle when disabled.
 *
 * No sourcemap upload / webpack plugin config here — that needs a
 * SENTRY_AUTH_TOKEN, which isn't available yet. Deferred to the deploy
 * phase (Phase 12/13).
 */

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV,
    });
  });
}
