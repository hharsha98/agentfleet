/**
 * Server-side observability entry point — Next.js 16's `instrumentation.ts`
 * file convention (register() runs once at server startup;
 * onRequestError() runs whenever the server catches an error). See
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md.
 *
 * Gated on NEXT_PUBLIC_SENTRY_DSN — blank (the default; no DSN exists in
 * this environment) means register() does nothing and onRequestError()
 * returns immediately, so server startup and error handling behave exactly
 * as before this file existed. @sentry/nextjs is only imported (dynamic
 * import) once a DSN is actually present, so it never inflates the server
 * bundle when disabled.
 *
 * No sourcemap upload / webpack plugin config here — that needs a
 * SENTRY_AUTH_TOKEN, which isn't available yet. Deferred to the deploy
 * phase (Phase 12/13).
 */
import type { Instrumentation } from "next";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

export async function register() {
  if (!dsn || process.env.NEXT_RUNTIME !== "nodejs") return;

  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
  });
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!dsn) return; // no-op: DSN unset, keep this a clean pass-through

  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(error, request, context);
};
