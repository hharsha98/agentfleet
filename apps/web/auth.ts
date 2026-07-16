import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET / AUTH_SECRET from env by convention.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
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
