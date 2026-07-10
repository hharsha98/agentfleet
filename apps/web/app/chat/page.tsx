import Link from "next/link";

import { ChatUI, type AgentInfo } from "@/components/chat-ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default async function ChatPage() {
  let agents: AgentInfo[] = [];
  try {
    const res = await fetch(`${API_URL}/api/v1/agents`, { cache: "no-store" });
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
        <span className="font-mono text-xs text-muted">
          {agents.length} agents online
        </span>
      </header>
      <ChatUI agents={agents} apiUrl={API_URL} />
    </div>
  );
}
