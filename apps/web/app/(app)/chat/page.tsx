import { ChatUI, type AgentInfo } from "@/components/chat-ui";
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
          online" text below, but every page still gets a real h1 for a11y. */}
      <h1 className="sr-only">Chat</h1>
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5 sm:px-6">
        <p className="text-sm text-muted">Multi-agent chat, streamed live.</p>
        <span className="font-mono text-xs text-muted">
          {agents.length} agents online
        </span>
      </div>
      <ChatUI agents={agents} />
    </div>
  );
}
