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
const GOOGLE_ENABLED = Boolean(process.env.AUTH_GOOGLE_ID);

const DEMO_USER = {
  id: "demo@agentfleet.local",
  email: "demo@agentfleet.local",
  name: "Demo Visitor",
};

// Reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET / AUTH_SECRET from env by convention.
// Google is omitted entirely when AUTH_GOOGLE_ID is unset so a public demo
// can ship without OAuth (demo login only) instead of crashing Auth.js.
export const { handlers, auth, signIn, signOut } = NextAuth({
  // HF Spaces / any reverse proxy send a Host the app did not bind to.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
  },
  providers: [
    ...(GOOGLE_ENABLED ? [Google] : []),
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
    // Credentials providers do not persist `user.email` onto the JWT unless
    // we copy it here. Chat (RSC) mints a JWT from session.user.email in
    // process; missions/agents/evals are client components that call
    // /api/token, which 401s if email is missing — that is the
    // "only Chat works after demo login" bug.
    async jwt({ token, user }) {
      if (user) {
        token.email = user.email ?? token.email;
        token.name = user.name ?? token.name;
        token.sub = user.id ?? user.email ?? token.sub;
      }
      if (!token.email && typeof token.sub === "string" && token.sub.includes("@")) {
        token.email = token.sub;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email =
          (typeof token.email === "string" && token.email) || session.user.email;
        session.user.name =
          (typeof token.name === "string" && token.name) || session.user.name;
      }
      return session;
    },
  },
});
