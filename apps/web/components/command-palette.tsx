"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Command = {
  label: string;
  hint: string; // shown as a small mono path, e.g. "/chat"
  glyph: string;
  href: string;
};

const COMMANDS: Command[] = [
  { label: "Chat", hint: "/chat", glyph: "💬", href: "/chat" },
  { label: "Documents", hint: "/documents", glyph: "📄", href: "/documents" },
  { label: "Missions", hint: "/missions", glyph: "🚀", href: "/missions" },
  { label: "Agents", hint: "/agents", glyph: "🤖", href: "/agents" },
  { label: "Templates", hint: "/templates", glyph: "🧩", href: "/templates" },
  { label: "Evals", hint: "/evals", glyph: "🧪", href: "/evals" },
  { label: "Playground", hint: "/playground", glyph: "⚗️", href: "/playground" },
  { label: "Voice", hint: "/voice", glyph: "🎙", href: "/voice" },
  { label: "Usage", hint: "/usage", glyph: "📊", href: "/usage" },
  { label: "Automations", hint: "/automations", glyph: "⏱", href: "/automations" },
  { label: "Changelog", hint: "/changelog", glyph: "🗒", href: "/changelog" },
  { label: "Home", hint: "/", glyph: "⌂", href: "/" },
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
  // Ctrl+K (focus address bar) / Cmd+K from firing alongside ours.
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
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                  i === highlighted ? "bg-accent/15 text-foreground" : "text-muted"
                }`}
              >
                <span aria-hidden="true">{command.glyph}</span>
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
