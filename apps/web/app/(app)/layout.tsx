import type { ReactNode } from "react";

import { AppNav } from "@/components/app-nav";
import { UserMenu } from "@/components/user-menu";

// Nested layout (NOT a root layout — app/layout.tsx above it still owns
// <html>/<body>/CommandPalette) scoped to the `(app)` route group via
// Next.js's parenthesized-folder convention, which is purely organizational
// and adds nothing to the URL: /chat, /documents, etc. are unchanged, and
// proxy.ts's path-based matcher still matches every request the same way.
//
// This is the one place <AppNav/> is mounted. It exists as a *server*
// component specifically so it can render the async, session-reading
// <UserMenu/> and hand the already-rendered element down into the client
// <AppNav/> as a prop — a Client Component can't import an async Server
// Component directly, but it can accept one as a ReactNode prop from a
// Server Component ancestor. Every page below (most of them "use client"
// for their own data fetching) no longer needs to know UserMenu exists.
export default function AppShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* Ambient ground (UI-7) — a SIBLING of <AppNav/> and {children}, never
          an ancestor wrapping either: e2e/workflows.spec.ts locates cards via
          page.locator("div", { hasText: name }).last(), which silently
          resolves to the wrong element the moment a card (or the page
          content around it) gains a new ancestor div. .af-app-ground is
          fixed + negative z-index (see app/globals.css), so its position in
          the DOM doesn't matter for layout — only that it paints behind
          everything else, which the negative z-index guarantees regardless
          of where in this flex column it's mounted. */}
      <div aria-hidden="true" className="af-app-ground pointer-events-none" />
      <AppNav userMenu={<UserMenu />} />
      {children}
    </div>
  );
}
