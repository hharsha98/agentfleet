// Phase 12 B2 — token mint route.
//
// Client components can't read the httpOnly Auth.js session cookie directly,
// so this route exchanges a valid Auth.js session for a short-lived HS256
// JWT that satisfies the API's auth contract (apps/api/app/auth.py):
//   { sub, email, name?, iat, exp }, signed with AUTH_SECRET.
// Signing itself lives in lib/api.ts (signApiToken) so this route and
// apiFetchServer share one definition of the claims contract.
//
// No session -> 401 JSON. Never cached across users: Next.js route handlers
// are NOT cached by default in this Next.js version (opt-in only, via
// `export const dynamic = "force-static"` on GET) — see
// node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
// "Caching" section — so no extra dynamic export is needed here.

import { auth } from "@/auth";
import { signApiToken } from "@/lib/api";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { token, expires_at } = await signApiToken(session.user.email, session.user.name);
    return Response.json({ token, expires_at });
  } catch {
    // Fail closed, matching the API's own "auth not configured" behavior.
    return Response.json({ error: "Auth not configured" }, { status: 503 });
  }
}
