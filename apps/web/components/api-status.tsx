"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function ApiStatus() {
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => setStatus(res.ok ? "online" : "offline"))
      .catch(() => setStatus("offline"));
  }, []);

  const dot = {
    checking: "bg-muted",
    online: "bg-emerald-400",
    offline: "bg-red-400",
  }[status];

  return (
    <div className="relative flex items-center gap-2 rounded-full border border-hairline px-3 py-1 font-mono text-xs text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      API {status}
    </div>
  );
}
