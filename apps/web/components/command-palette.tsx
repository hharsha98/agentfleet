"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type IconName =
  | "chat"
  | "document"
  | "rocket"
  | "workflow"
  | "robot"
  | "blocks"
  | "flask"
  | "shield"
  | "compare"
  | "activity"
  | "clock"
  | "mic"
  | "list"
  | "home";

// Hand-inlined, Lucide-style (24x24, stroke-based, rounded caps) icons — no
// icon package dependency, matching the idiom already used on the landing
// page and every app page's EmptyState. Plain muted stroke (not hue-tinted
// tiles) keeps a 12-row dropdown list calm rather than busy.
function Icon({ name }: { name: IconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-4 w-4 shrink-0",
    "aria-hidden": true,
  };

  switch (name) {
    case "chat":
      return (
        <svg {...common}>
          <path d="M4 5.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9l-4.5 4V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
        </svg>
      );
    case "document":
      return (
        <svg {...common}>
          <path d="M6.5 3.5h7.5L18.5 8v12.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
          <path d="M14 3.5V8h4.5" />
        </svg>
      );
    case "rocket":
      return (
        <svg {...common}>
          <path d="M12 3c2.8 1.6 4.5 4.6 4.5 8.5 0 2-1 4-2.3 5.3L12 19l-2.2-2.2C8.5 15.5 7.5 13.5 7.5 11.5 7.5 7.6 9.2 4.6 12 3Z" />
          <circle cx="12" cy="10.5" r="1.6" />
        </svg>
      );
    case "workflow":
      return (
        <svg {...common}>
          <circle cx="5.5" cy="6" r="2.25" />
          <circle cx="5.5" cy="18" r="2.25" />
          <circle cx="18.5" cy="12" r="2.25" />
          <path d="M7.6 6.9 16.5 11M7.6 17.1 16.5 13" />
        </svg>
      );
    case "robot":
      return (
        <svg {...common}>
          <rect x="4.5" y="8.5" width="15" height="10.5" rx="2.5" />
          <path d="M12 8.5V5M9.5 5h5" />
          <circle cx="9" cy="13.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="13.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "blocks":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.25" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.25" />
          <rect x="8.5" y="13.5" width="7" height="7" rx="1.25" />
        </svg>
      );
    case "flask":
      return (
        <svg {...common}>
          <path d="M9.5 3.5h5M10 3.5v6.2L5.6 17c-.7 1.3.2 2.9 1.7 2.9h9.4c1.5 0 2.4-1.6 1.7-2.9L14 9.7V3.5" />
          <path d="M7.5 15h9" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3.25 4.75 6v5.4c0 4.4 3 7.9 7.25 9.35 4.25-1.45 7.25-4.95 7.25-9.35V6L12 3.25Z" />
        </svg>
      );
    case "compare":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="7.5" height="14" rx="1.5" />
          <rect x="13" y="5" width="7.5" height="14" rx="1.5" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <path d="M3 12h4l2-6 4 12 2-8 2 2h4" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.25" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      );
    case "mic":
      return (
        <svg {...common}>
          <rect x="9" y="3.5" width="6" height="11" rx="3" />
          <path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21M9 21h6" />
        </svg>
      );
    case "list":
      return (
        <svg {...common}>
          <path d="M8 6.5h11M8 12h11M8 17.5h11" />
          <circle cx="4" cy="6.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="4" cy="17.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "home":
      return (
        <svg {...common}>
          <path d="M4 11.5 12 4l8 7.5" />
          <path d="M6 10v9.5a1 1 0 0 0 1 1h3.5v-6h3v6H17a1 1 0 0 0 1-1V10" />
        </svg>
      );
    default:
      return null;
  }
}

type Command = {
  label: string;
  hint: string; // shown as a small mono path, e.g. "/chat"
  icon: IconName;
  href: string;
};

const COMMANDS: Command[] = [
  { label: "Chat", hint: "/chat", icon: "chat", href: "/chat" },
  { label: "Documents", hint: "/documents", icon: "document", href: "/documents" },
  { label: "Missions", hint: "/missions", icon: "rocket", href: "/missions" },
  { label: "Workflows", hint: "/workflows", icon: "workflow", href: "/workflows" },
  { label: "Agents", hint: "/agents", icon: "robot", href: "/agents" },
  { label: "Templates", hint: "/templates", icon: "blocks", href: "/templates" },
  { label: "Evals", hint: "/evals", icon: "flask", href: "/evals" },
  { label: "Guardrails", hint: "/guardrails", icon: "shield", href: "/guardrails" },
  { label: "Playground", hint: "/playground", icon: "compare", href: "/playground" },
  { label: "Voice", hint: "/voice", icon: "mic", href: "/voice" },
  { label: "Usage", hint: "/usage", icon: "activity", href: "/usage" },
  { label: "Automations", hint: "/automations", icon: "clock", href: "/automations" },
  { label: "Changelog", hint: "/changelog", icon: "list", href: "/changelog" },
  { label: "Home", hint: "/", icon: "home", href: "/" },
];

// Global ⌘K / Ctrl+K launcher, mounted once in the root layout. Renders
// nothing (not even a hidden DOM node) while closed — the only always-on
// cost is a single window keydown listener.
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [prevQuery, setPrevQuery] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const filtered = COMMANDS.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()),
  );

  // Reset the highlighted row whenever the query changes. Adjusting state
  // during render (React's documented pattern for "reset on prop change")
  // instead of in a useEffect avoids an extra render pass.
  if (query !== prevQuery) {
    setPrevQuery(query);
    setHighlighted(0);
  }

  function close() {
    setOpen(false);
    setQuery("");
    setHighlighted(0);
    // Restore focus to whatever had it before the palette opened, falling
    // back to the body so focus never gets stranded on a removed node.
    (previouslyFocused.current ?? document.body).focus();
  }

  function run(command: Command) {
    close();
    router.push(command.href);
  }

  // Global open/close shortcut. preventDefault stops the browser's own
  // Ctrl+K (focus address bar) / Cmd+K from firing alongside ours. Also
  // fires when components/app-nav.tsx's "⌘K" chip dispatches this same
  // synthetic keydown on window.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isModK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isModK) {
        e.preventDefault();
        setOpen((wasOpen) => {
          if (!wasOpen) {
            previouslyFocused.current = document.activeElement as HTMLElement | null;
          }
          return !wasOpen;
        });
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Autofocus the input whenever the palette opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) =>
        filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const command = filtered[highlighted];
      if (command) run(command);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 pt-[15vh]"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-lg border border-hairline bg-background shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Jump to…"
          className="w-full border-b border-hairline bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted"
        />
        <ul role="listbox" className="max-h-80 overflow-y-auto py-1">
          {filtered.map((command, i) => (
            <li key={command.href} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={i === highlighted}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => run(command)}
                className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm transition-colors duration-150 ${
                  i === highlighted ? "bg-accent/15 text-foreground" : "text-muted"
                }`}
              >
                <Icon name={command.icon} />
                <span className="flex-1">{command.label}</span>
                <span className="font-mono text-xs text-muted">{command.hint}</span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">No matching commands.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
