import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET / AUTH_SECRET from env by convention.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
});
