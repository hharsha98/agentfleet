import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

// Public-demo sign-in door. OFF by default — a plain `git clone` + local
// run never sees this provider at all (see the conditional spread below),
// so nobody accidentally ships a passwordless login in a private
// deployment. Flip it on ONLY for the hosted public demo via
// DEMO_LOGIN_ENABLED=1 (see .env.example).
//
// This is a door, not a security boundary: every visitor who uses it
// becomes the SAME fixed identity (DEMO_USER below), never an
// attacker-chosen one — authorize() takes no credentials input and always
// returns that one object, so there is nothing to smuggle a different
// email/id through. What actually bounds abuse once signed in is the app's
// existing per-agent/global daily budget system
// (apps/api/app/services/budget.py), seeded tight for this identity by
// apps/api/scripts/seed_demo_user.py — not anything in this file.
const DEMO_LOGIN_ENABLED = process.env.DEMO_LOGIN_ENABLED === "1";

const DEMO_USER = {
  id: "demo@agentfleet.local",
  email: "demo@agentfleet.local",
  name: "Demo Visitor",
};

// Reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET / AUTH_SECRET from env by convention.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google,
    ...(DEMO_LOGIN_ENABLED
      ? [
          Credentials({
            id: "demo",
            name: "Demo",
            // Empty on purpose: Auth.js's default sign-in page renders one
            // input per key of `credentials` (see
            // node_modules/@auth/core/src/lib/pages/signin.tsx), so `{}`
            // renders NO fields at all — just a single "Sign in with Demo"
            // button. Nothing to type, nothing to guess, no password.
            credentials: {},
            // Ignores whatever the request carries (there is nothing to
            // read) and always resolves to the one fixed demo identity.
            // Can never authenticate as, or create, an arbitrary account.
            async authorize() {
              return DEMO_USER;
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    // Invoked by proxy.ts (Phase 12 B2 page gating) for every request that
    // matches its `matcher` — i.e. only the protected app pages listed
    // there. Returning false triggers next-auth's default behavior: redirect
    // to the Auth.js sign-in page with a callbackUrl back to the original
    // page (see node_modules/next-auth/src/lib/index.ts handleAuth()).
    authorized({ auth: session }) {
      return !!session?.user;
    },
  },
});
