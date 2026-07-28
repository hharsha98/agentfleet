// Phase 12 B2 — page gating.
//
// This Next.js version renamed the `middleware.ts` file convention to
// `proxy.ts` (function name `proxy`, default or named export) — confirmed
// via node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md,
// which flags `middleware.ts` as deprecated ("Please use proxy instead").
// A `middleware.ts` file would still build (with a deprecation warning) but
// this repo's AGENTS.md says to heed deprecation notices, so we use the
// current convention directly.
//
// `auth` (from ./auth.ts) doubles as a proxy function per next-auth v5's
// documented pattern (see node_modules/next-auth/index.d.ts —
// `export { auth as middleware } from "./auth"`, same shape applies here
// under the `proxy` export name). Gating logic itself lives in auth.ts's
// `callbacks.authorized`; the matcher below scopes proxy to run ONLY on the
// protected app pages, so every request that reaches `authorized()` here is
// one that must have a session.
export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
    "/chat/:path*",
    "/documents/:path*",
    "/missions/:path*",
    "/agents/:path*",
    "/templates/:path*",
    "/evals/:path*",
    "/usage/:path*",
    "/automations/:path*",
    "/playground/:path*",
    "/voice/:path*",
    "/workflows/:path*",
  ],
};
