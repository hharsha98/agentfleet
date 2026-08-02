import { ChatUI, type AgentInfo } from "@/components/chat-ui";
import { Icon } from "@/components/landing/icons";
import { Term } from "@/components/term";
import { apiFetchServer } from "@/lib/api";

export default async function ChatPage() {
  let agents: AgentInfo[] = [];
  try {
    const res = await apiFetchServer("/api/v1/agents", { cache: "no-store" });
    if (res.ok) agents = await res.json();
  } catch {
    // API offline — ChatUI renders the empty-state hint.
  }

  return (
    // Bounded to the viewport minus the app nav's own height (--app-nav-h,
    // globals.css), NOT `flex-1` on a `min-h-full` ancestor — every ancestor
    // up to <body> only sets a MINIMUM height (see app/(app)/layout.tsx and
    // app/layout.tsx), on purpose, so the other 12 app pages keep scrolling
    // as a normal document behind the sticky nav. flex-1 in that chain has
    // nothing bounded to grow into, so this page's content used to just
    // keep growing the whole document — which is exactly why the composer
    // rendered ~450px below the fold (see the chat UX pass this fixed).
    // Giving THIS ONE route a real height, instead, makes ChatUI's own
    // `overflow-y-auto` message pane (chat-ui.tsx) the thing that scrolls,
    // so the composer stays on screen without touching the shared layout
    // every other page relies on. `var(..., 59px)` repeats the CSS var's own
    // fallback so this still degrades sanely if the var is ever missing.
    <div className="flex h-[calc(100dvh-var(--app-nav-h,59px))] flex-col overflow-hidden">
      {/* Chat has no visible page title in the design (the agent chips row
          reads as the header) — smoke.spec.ts only asserts the "agents
          online" text below, but every page still gets a real h1 for a11y.
          The header bar below stays a compact single row (not the full
          PageHeader) so it doesn't eat into ChatUI's scroll area. */}
      <h1 className="sr-only">Chat</h1>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-hue-blue/25 bg-hue-blue/10"
          >
            <Icon name="chat" className="h-3.5 w-3.5 text-hue-blue" />
          </span>
          {/* No `truncate` here any more, and that is not a style tweak: it
              sets overflow:hidden, which clipped the Term tooltip against
              the paragraph's own box so the definition opened invisibly.
              The line was shortened to compensate — it still sits on one row
              at every width the old sentence did. */}
          <p className="text-sm text-muted">
            Talk to any agent. Watch its <Term k="tool_call">tool calls</Term>{" "}
            and open its <Term k="artifact">artifacts</Term> as it works.
          </p>
        </div>
        <span className="shrink-0 font-mono text-xs text-muted">
          {agents.length} agents online
        </span>
      </div>
      <ChatUI agents={agents} />
    </div>
  );
}
