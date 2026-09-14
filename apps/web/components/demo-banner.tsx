import Link from "next/link";

export function DemoBanner() {
  return (
    <div
      role="status"
      className="border-b border-hairline bg-surface-2 px-4 py-2 text-center font-mono text-xs text-muted"
    >
      Shared public demo — every visitor is{" "}
      <span className="text-foreground">demo@agentfleet.local</span> with a daily
      token cap.{" "}
      <Link
        href="https://github.com/hharsha98/agentfleet/blob/main/docs/DEPLOY.md"
        className="underline underline-offset-4 hover:text-foreground"
      >
        Self-host for a private fleet
      </Link>
      .
    </div>
  );
}
