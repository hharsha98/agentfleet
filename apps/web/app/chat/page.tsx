import Link from "next/link";

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
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-hairline px-6 py-3">
        <Link href="/" className="font-medium tracking-tight">
          AgentFleet
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted">
          <span className="text-foreground">Chat</span>
          <Link href="/documents" className="hover:text-foreground">
            Documents
          </Link>
          <Link href="/missions" className="hover:text-foreground">
            Missions
          </Link>
          <Link href="/agents" className="hover:text-foreground">
            Agents
          </Link>
          <Link href="/templates" className="hover:text-foreground">
            Templates
          </Link>
          <Link href="/evals" className="hover:text-foreground">
            Evals
          </Link>
          <Link href="/usage" className="hover:text-foreground">
            Usage
          </Link>
          <Link href="/automations" className="hover:text-foreground">
            Automations
          </Link>
          <span className="font-mono text-xs">{agents.length} agents online</span>
        </nav>
      </header>
      <ChatUI agents={agents} />
    </div>
  );
}
