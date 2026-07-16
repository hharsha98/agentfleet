// Phase 12 B2 — thin fetch wrappers that attach the short-lived API JWT
// (contract verified by apps/api/app/auth.py: { sub, email, name?, iat,
// exp }, HS256, signed with AUTH_SECRET) to every call to the FastAPI
// backend.
//
// apiFetch() is for CLIENT components — it lazily fetches + caches the
// token in a module-level variable (scoped to this one browser tab's JS
// runtime, so there's no cross-user leakage — each browser gets its own
// copy of this module's state), refreshes it ~60s before expiry, and
// retries once on a 401 (token could have expired mid-flight or been
// revoked). apiFetchServer() is for SERVER components — it mints a fresh
// JWT directly from the current Auth.js session on every call, no HTTP
// round-trip to /api/token needed since auth() and jose both run in-process
// on the server.
//
// signApiToken() is shared by both this file's apiFetchServer() and
// app/api/token/route.ts, so the claims contract is defined in exactly one
// place.

import { SignJWT } from "jose";

import { auth } from "@/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const REFRESH_SKEW_SECONDS = 60;
export const TOKEN_TTL_SECONDS = 15 * 60; // keep exp short per the B1 contract

/** Signs the contract JWT for a given user. Throws if AUTH_SECRET is unset. */
export async function signApiToken(
  email: string,
  name?: string | null,
): Promise<{ token: string; expires_at: number }> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured");
  }
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_TTL_SECONDS;
  const token = await new SignJWT({ sub: email, email, name: name ?? undefined })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));
  return { token, expires_at: exp };
}

// --- client -----------------------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;
let inFlightTokenFetch: Promise<string> | null = null;

class SignedOutError extends Error {
  constructor() {
    super("Signed out — redirecting to sign-in");
    this.name = "SignedOutError";
  }
}

async function fetchToken(): Promise<string> {
  const res = await fetch("/api/token");
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href = "/api/auth/signin";
    }
    throw new SignedOutError();
  }
  if (!res.ok) {
    throw new Error(`Failed to mint API token (${res.status})`);
  }
  const data = (await res.json()) as { token: string; expires_at: number };
  cachedToken = { token: data.token, expiresAt: data.expires_at };
  return data.token;
}

async function getToken(forceRefresh = false): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - REFRESH_SKEW_SECONDS > now) {
    return cachedToken.token;
  }
  // Coalesce concurrent callers onto a single in-flight mint request.
  if (!inFlightTokenFetch) {
    inFlightTokenFetch = fetchToken().finally(() => {
      inFlightTokenFetch = null;
    });
  }
  return inFlightTokenFetch;
}

/**
 * Fetch wrapper for CLIENT components. Attaches `Authorization: Bearer
 * <token>` to every call, refreshing the cached token ~60s before it
 * expires. On a 401 response from the API it drops the cache, mints a new
 * token once, and retries the request once. Returns the raw `Response` so
 * callers that need `res.body` (SSE streaming) keep working unchanged.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    cachedToken = null;
    const freshToken = await getToken(true);
    const retryHeaders = new Headers(init.headers);
    retryHeaders.set("Authorization", `Bearer ${freshToken}`);
    res = await fetch(`${API_BASE}${path}`, { ...init, headers: retryHeaders });
  }

  return res;
}

// --- server -------------------------------------------------------------------

/**
 * Fetch wrapper for SERVER components. Mints a fresh JWT directly from the
 * current Auth.js session per request. If there's no session (shouldn't
 * happen on a gated page — see middleware/proxy — but pages can also call
 * this defensively), the request is sent without an Authorization header
 * and the API will 401 it.
 */
export async function apiFetchServer(path: string, init: RequestInit = {}): Promise<Response> {
  const session = await auth();
  const headers = new Headers(init.headers);

  if (session?.user?.email) {
    const { token } = await signApiToken(session.user.email, session.user.name);
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(`${API_BASE}${path}`, { ...init, headers });
}
