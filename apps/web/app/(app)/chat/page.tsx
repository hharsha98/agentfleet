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
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Chat has no visible page title in the design (the agent chips row
          reads as the header) — smoke.spec.ts only asserts the "agents
          online" text below, but every page still gets a real h1 for a11y.
          The header bar below stays a compact single row (not the full
          PageHeader) so it doesn't eat into ChatUI's scroll area. */}
      <h1 className="sr-only">Chat</h1>
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5 sm:px-6">
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
