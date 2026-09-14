import Link from "next/link";

import { signIn } from "@/auth";
import { Wordmark } from "@/components/brand/logo";
import { GLOW_HOVER, HUE_GLOW } from "@/components/ui/glow";
import { publicConfigFromEnv } from "@/lib/public-config";

export const dynamic = "force-dynamic";

function safeRedirectTo(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== "string") return "/chat";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://")) {
    return "/chat";
  }
  return value;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const params = await searchParams;
  const redirectTo = safeRedirectTo(params.callbackUrl);
  const { demoLogin, googleLogin } = publicConfigFromEnv();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-xl border border-hairline bg-surface-1 p-8">
        <Link href="/" className="mb-8 inline-block">
          <Wordmark />
        </Link>
        <h1 className="text-2xl font-medium tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted">
          {demoLogin
            ? "One-click demo uses a shared identity with a daily token cap. After sign-in, Chat, Missions, Workflows, Agents, and Documents are all in the nav — not Chat-only. Google is optional."
            : "Sign in to run the fleet. Self-host for a private instance."}
        </p>

        <div className="mt-8 flex flex-col gap-3">
          {demoLogin && (
            <form
              action={async () => {
                "use server";
                await signIn("demo", { redirectTo });
              }}
            >
              <button
                type="submit"
                className={`w-full cursor-pointer rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 ${HUE_GLOW.accent} ${GLOW_HOVER}`}
              >
                Try the demo
              </button>
            </form>
          )}
          {googleLogin && (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo });
              }}
            >
              <button
                type="submit"
                className="w-full cursor-pointer rounded-md border border-hairline px-4 py-2.5 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-surface-2"
              >
                Continue with Google
              </button>
            </form>
          )}
          {!demoLogin && !googleLogin && (
            <p className="text-sm text-muted">
              Auth is not configured on this instance. Set{" "}
              <code className="font-mono text-xs">DEMO_LOGIN_ENABLED=1</code> for the
              public demo door, or <code className="font-mono text-xs">AUTH_GOOGLE_ID</code>{" "}
              for Google OAuth. See{" "}
              <a
                href="https://github.com/hharsha98/agentfleet/blob/main/docs/DEPLOY.md"
                className="underline underline-offset-4 hover:text-foreground"
              >
                docs/DEPLOY.md
              </a>
              .
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
