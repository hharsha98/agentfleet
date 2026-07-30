"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Wordmark } from "@/components/brand/logo";
import { GLOW_HOVER, HUE_TONE } from "@/components/ui/glow";

// Shared top nav for every app-shell page (chat, documents, missions, …).
// Mounted once by app/(app)/layout.tsx — NOT re-declared per page — so this
// is the single source of truth for the app-shell header idiom (sticky,
// backdrop-blur, hairline border) that matches the landing page's header.
type NavItem = { href: string; label: string };

// The split below is the whole point of this component's second draft. All
// 13 destinations used to sit in one row; at 1280px the tail was sliced
// mid-word, which is a bad first impression for the first thing anyone sees.
//
// PRIMARY is "what the fleet does", in the order you'd actually use it:
// talk to it (Chat), give it work (Missions), shape that work (Workflows),
// staff it (Agents), feed it (Documents).
const PRIMARY_ITEMS: NavItem[] = [
  { href: "/chat", label: "Chat" },
  { href: "/missions", label: "Missions" },
  { href: "/workflows", label: "Workflows" },
  { href: "/agents", label: "Agents" },
  { href: "/documents", label: "Documents" },
];

// OVERFLOW is everything you visit deliberately rather than constantly —
// measurement, policy, and reference. Nothing is lost by moving it here:
// every one of these is also a row in the ⌘K palette (see the COMMANDS
// array in components/command-palette.tsx, which lists all 13 plus Home),
// so the palette stays the complete index and this menu is a shortcut, not
// the only door.
const OVERFLOW_ITEMS: NavItem[] = [
  { href: "/evals", label: "Evals" },
  { href: "/guardrails", label: "Guardrails" },
  { href: "/usage", label: "Usage" },
  { href: "/automations", label: "Automations" },
  { href: "/playground", label: "Playground" },
  { href: "/voice", label: "Voice" },
  { href: "/templates", label: "Templates" },
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

// One destination in the always-visible row. The active underline is an
// absolutely-positioned hairline that lands on the header's own bottom
// border (-bottom-[13px] = the header's py-3 plus its 1px border), so it
// reads as the tab-strip idiom rather than a second line inside the row.
function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`relative shrink-0 cursor-pointer whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors duration-200 ${
        active ? "text-foreground" : "text-muted hover:text-foreground"
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
}

// The overflow menu. Deliberately a DISCLOSURE (button + a plain list of
// links), not an ARIA `role="menu"`: a real menu wants roving tabindex,
// which takes its items OUT of the tab order. Keeping them as ordinary
// links means Tab walks the open menu exactly as a sighted keyboard user
// expects, and the arrow keys below are an addition rather than the only
// way through.
//
// `items` arrives already filtered by the parent — see the promotion note
// there. This component never has to render an active item.
function MoreMenu({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  // Close on route change. Done by adjusting state DURING RENDER (React's
  // documented "reset state when a value changes" pattern, already used by
  // components/command-palette.tsx for its highlighted row) rather than in
  // a useEffect: this repo's lint gate has react-hooks/set-state-in-effect
  // switched on as an error, and a `useEffect(() => setOpen(false),
  // [pathname])` would add a tenth error to it.
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  function closeAndRestoreFocus() {
    setOpen(false);
    // Focus must come back to the trigger, or a keyboard user who pressed
    // Escape is left with focus on a node that just left the document and
    // the next Tab restarts from the top of the page.
    triggerRef.current?.focus();
  }

  // Move focus into the menu as soon as it opens. Not a setState, so the
  // set-state-in-effect rule above doesn't apply; it mirrors the palette's
  // own "autofocus the input when it opens" effect.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  // Outside click. pointerdown rather than click so the menu is already
  // gone by the time a click lands on whatever is underneath, and only
  // while open so the app carries no listener at rest.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function focusByOffset(delta: number) {
    const els = itemRefs.current;
    if (els.length === 0) return;
    const current = els.findIndex((el) => el === document.activeElement);
    const next =
      current === -1
        ? delta > 0
          ? 0
          : els.length - 1
        : (current + delta + els.length) % els.length;
    els[next]?.focus();
  }

  // One handler on the wrapper covers the trigger AND the links, since
  // React's synthetic keydown bubbles. Enter/Space need no code at all —
  // the trigger is a real <button>, so the browser turns both into a click.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      if (!open) return;
      // The command palette listens for Escape on window; the innermost
      // dismissible layer should be the one that closes.
      e.stopPropagation();
      e.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // Arrowing from the closed trigger opens it; the effect above then
      // lands focus on the first item.
      if (!open) setOpen(true);
      else focusByOffset(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (open && (e.key === "Home" || e.key === "End")) {
      e.preventDefault();
      const els = itemRefs.current;
      (e.key === "Home" ? els[0] : els[els.length - 1])?.focus();
    }
  }

  return (
    <div
      ref={wrapperRef}
      className="relative shrink-0"
      onKeyDown={onKeyDown}
      // React's onBlur is focusout, which bubbles — so this fires for the
      // links too and closes the menu when Tab walks past the last one.
      // relatedTarget is where focus is GOING; inside the wrapper means the
      // user is still in the menu.
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        // No .af-glow-*/HUE_TONE here on purpose: those rules are unlayered
        // and beat Tailwind's box-shadow-based ring-* utilities, so a glow
        // on this button would swallow its focus ring — the same trap
        // documented on the wordmark below and in components/term.tsx.
        className={`flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          open ? "bg-accent/15 text-foreground" : "text-muted hover:text-foreground"
        }`}
      >
        More
        <span
          aria-hidden="true"
          className={`af-menu-chevron text-[9px] transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <nav
          id={panelId}
          aria-label="More destinations"
          className="animate-menu-in absolute right-0 top-full z-50 mt-2 flex w-44 flex-col rounded-md border border-hairline bg-background p-1 shadow-lg"
        >
          {items.map((item, i) => (
            <Link
              key={item.href}
              href={item.href}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded-md px-2.5 py-1.5 text-muted transition-colors duration-200 hover:bg-accent/15 hover:text-foreground focus-visible:bg-accent/15 focus-visible:text-foreground focus-visible:outline-none"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

export function AppNav({ userMenu }: { userMenu?: ReactNode }) {
  const pathname = usePathname();

  // If the page you are ON lives in the overflow group, it gets promoted
  // into the visible row and removed from the menu. Hiding the user's own
  // location behind a closed menu is the one thing an overflow pattern must
  // never do — you'd be on /usage with nothing on screen saying so. It is
  // moved rather than duplicated so there is exactly one aria-current="page"
  // in the header, and so the row never grows past six items.
  const promoted = OVERFLOW_ITEMS.find((item) => item.href === pathname);
  const primaryItems = promoted ? [...PRIMARY_ITEMS, promoted] : PRIMARY_ITEMS;
  const menuItems = promoted
    ? OVERFLOW_ITEMS.filter((item) => item.href !== promoted.href)
    : OVERFLOW_ITEMS;

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-background/70 backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-3 sm:gap-5 sm:px-6">
        {/* The wordmark is the one true logo in the app shell, so it gets
            the accent hover bloom. The glow sits on this wrapper span, never
            on the <Link> itself: a link is focusable, and .af-glow-* is
            unlayered CSS that beats Tailwind's box-shadow-based ring-*
            utilities — putting it on the anchor would pre-emptively break
            any focus ring added there later. The span is inline-flex +
            shrink-0 so it occupies exactly the box the Link used to. */}
        <span className={`inline-flex shrink-0 rounded-md ${HUE_TONE.accent} ${GLOW_HOVER}`}>
          <Link
            href="/"
            className="cursor-pointer transition-opacity duration-200 hover:opacity-80"
          >
            {/* Wordmark carries the mark + the same font-medium
                tracking-tight type the bare text had, so the glow span's
                box only grows by the 20px mark plus its gap. */}
            <Wordmark />
          </Link>
        </span>

        {/* Five destinations (six on an overflow route, see the promotion
            above) plus a menu, instead of the 13-wide scrolling row this
            used to be. An earlier draft of this file argued against a menu
            on the grounds that it would hide link names from selector-based
            E2E specs; that was never true and is not true now — `grep -rn`
            over apps/web/e2e/ finds no spec that selects a nav link. The
            suite reaches pages with page.goto() and asserts on each page's
            own <h1> (e2e/smoke.spec.ts), and the only getByRole("link")
            calls in the whole directory are for the workflow detail page's
            "← All workflows" back link.

            The row keeps overflow-x-auto and the fade below for narrow
            phones, where even five items can outrun the viewport. The fade
            is painted over the END of the row, so when everything fits it
            covers empty background and is invisible — no width measurement,
            no resize listener, no state. */}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="relative flex min-w-0 flex-1 items-center">
            <nav
              aria-label="Primary"
              className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto font-mono text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {primaryItems.map((item) => (
                <NavLink key={item.href} item={item} active={pathname === item.href} />
              ))}
            </nav>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent"
            />
          </div>

          <div className="font-mono text-xs">
            <MoreMenu items={menuItems} pathname={pathname} />
          </div>
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
