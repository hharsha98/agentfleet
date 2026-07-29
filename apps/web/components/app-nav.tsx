"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Shared top nav for every app-shell page (chat, documents, missions, …).
// Mounted once by app/(app)/layout.tsx — NOT re-declared per page — so this
// is the single source of truth for the app-shell header idiom (sticky,
// backdrop-blur, hairline border) that matches the landing page's header.
const NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/chat", label: "Chat" },
  { href: "/documents", label: "Documents" },
  { href: "/missions", label: "Missions" },
  { href: "/workflows", label: "Workflows" },
  { href: "/agents", label: "Agents" },
  { href: "/templates", label: "Templates" },
  { href: "/evals", label: "Evals" },
  { href: "/guardrails", label: "Guardrails" },
  { href: "/usage", label: "Usage" },
  { href: "/automations", label: "Automations" },
  { href: "/playground", label: "Playground" },
  { href: "/voice", label: "Voice" },
  { href: "/changelog", label: "Changelog" },
];

// Opens the existing global CommandPalette (mounted once in the root
// layout) by dispatching the exact same synthetic keydown it already
// listens for on `window` — the palette owns all open/close/query state,
// so this is the smallest correct integration: no new event channel, no
// prop drilling, no duplicated shortcut logic.
function openCommandPalette() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
  );
}

export function AppNav({ userMenu }: { userMenu?: ReactNode }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-background/70 backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-3 sm:gap-5 sm:px-6">
        <Link
          href="/"
          className="shrink-0 cursor-pointer font-medium tracking-tight transition-opacity duration-200 hover:opacity-80"
        >
          AgentFleet
        </Link>

        {/* Simplest correct responsive treatment per the design brief: one
            horizontally-scrolling row at every width, rather than a
            hamburger menu that would hide link names from selector-based
            E2E specs.

            The scrollbar is hidden, so with 12 destinations the last item
            gets sliced mid-word at ordinary widths and reads as a broken
            layout rather than a scrollable one. The fade below is that
            missing affordance. It is painted over the END of the row, so
            when everything fits it covers empty space and is invisible —
            no width measurement, no resize listener, no state (state here
            would also have added a tenth react-hooks/set-state-in-effect
            error to an already-red lint gate). */}
        <div className="relative flex min-w-0 flex-1 items-center">
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto font-mono text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative shrink-0 cursor-pointer whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors duration-200 ${
                  active
                    ? "text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 -bottom-[13px] h-px bg-accent"
                  />
                )}
              </Link>
            );
          })}
        </nav>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent"
          />
        </div>

        <button
          type="button"
          onClick={openCommandPalette}
          className="hidden shrink-0 cursor-pointer items-center gap-1 rounded-full border border-hairline px-2.5 py-1 font-mono text-[11px] text-muted transition-colors duration-200 hover:border-accent/40 hover:text-foreground sm:inline-flex"
        >
          <span aria-hidden="true">⌘</span>
          <span>K</span>
        </button>

        <div className="shrink-0">{userMenu}</div>
      </div>
    </header>
  );
}
