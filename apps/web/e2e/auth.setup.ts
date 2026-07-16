// Phase 12 B2 — Playwright global setup: forges a REAL Auth.js session
// cookie for a fixed test identity, so the deterministic + llm E2E suites
// can drive the now-gated app WITHOUT any auth-bypass code in the app
// itself (locked design — see docs/PRODUCTION_PLAN.md Phase 12 B2).
//
// How this works: next-auth v5's session cookie value is an ENCRYPTED JWE
// (alg "dir", enc "A256CBC-HS512" — see node_modules/@auth/core/src/jwt.ts
// `encode()`), derived from AUTH_SECRET plus a "salt" that next-auth v5
// always sets to the session cookie's own NAME. Confirmed by grepping the
// installed source: node_modules/@auth/core/src/lib/actions/session.ts and
// .../callback/index.ts both do `const salt = options.cookies.sessionToken.name`
// before every `jwt.encode()` call. We call that exact same `encode()`
// (re-exported as `next-auth/jwt` -> `@auth/core/jwt`) with that same salt,
// so the cookie this script produces decrypts identically to one a real
// Google sign-in would produce — same code path, same verification, no
// special-casing anywhere in app source.
//
// Cookie name: dev/E2E both run on http://localhost (not https), and
// next-auth only adds the `__Secure-` prefix when `useSecureCookies` is
// true — see node_modules/@auth/core/src/lib/utils/cookie.ts
// `defaultCookies()`. So the unprefixed name applies: "authjs.session-token".

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { encode } from "next-auth/jwt";

const SESSION_COOKIE_NAME = "authjs.session-token";

const TEST_USER = {
  email: "e2e@test.local",
  name: "E2E Test User",
  sub: "e2e@test.local",
};

/** Reads AUTH_SECRET from the repo root .env. Never logs the value. */
function readAuthSecret(): string {
  // apps/web/e2e/auth.setup.ts -> repo root is three directories up.
  const envPath = path.resolve(__dirname, "../../../.env");
  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== "AUTH_SECRET") continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  throw new Error("AUTH_SECRET not found in repo root .env");
}

// Playwright's globalSetup contract is (config: FullConfig) => unknown; we
// don't need the config object, and TS/JS both allow declaring fewer
// params than the caller passes.
export default async function globalSetup() {
  const secret = readAuthSecret();
  if (!secret) throw new Error("AUTH_SECRET is empty in repo root .env");

  const sessionToken = await encode({
    token: TEST_USER,
    secret,
    salt: SESSION_COOKIE_NAME,
  });

  const nowSeconds = Math.floor(Date.now() / 1000);
  const state = {
    cookies: [
      {
        name: SESSION_COOKIE_NAME,
        value: sessionToken,
        domain: "localhost",
        path: "/",
        // Matches encode()'s own default maxAge (30 days) — plenty for a
        // local/CI test run; nothing needs a shorter-lived cookie here.
        expires: nowSeconds + 30 * 24 * 60 * 60,
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };

  const outDir = path.resolve(__dirname, ".auth");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "state.json"), JSON.stringify(state, null, 2));
}
