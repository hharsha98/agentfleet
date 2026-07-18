// Shared hue-tinted icon infrastructure for the landing page. Extracted out
// of feature-grid.tsx (UI-3) so ops-layer, deep-dives, how-it-works, and
// automations-security can all reuse the same Icon switch + IconTile without
// duplicating the hue class map in five places. No icon package dependency —
// every glyph below is a hand-inlined, Lucide-style 24x24 stroke path.

export type Hue = "blue" | "violet" | "cyan" | "amber" | "green" | "red";

export const HUE_CLASSES: Record<
  Hue,
  { tile: string; icon: string; glow: string }
> = {
  blue: {
    tile: "bg-hue-blue/10 border-hue-blue/25",
    icon: "text-hue-blue",
    glow: "bg-hue-blue/20",
  },
  violet: {
    tile: "bg-hue-violet/10 border-hue-violet/25",
    icon: "text-hue-violet",
    glow: "bg-hue-violet/20",
  },
  cyan: {
    tile: "bg-hue-cyan/10 border-hue-cyan/25",
    icon: "text-hue-cyan",
    glow: "bg-hue-cyan/20",
  },
  amber: {
    tile: "bg-hue-amber/10 border-hue-amber/25",
    icon: "text-hue-amber",
    glow: "bg-hue-amber/20",
  },
  green: {
    tile: "bg-hue-green/10 border-hue-green/25",
    icon: "text-hue-green",
    glow: "bg-hue-green/20",
  },
  red: {
    tile: "bg-hue-red/10 border-hue-red/25",
    icon: "text-hue-red",
    glow: "bg-hue-red/20",
  },
};

export type IconName =
  | "chat"
  | "workflow"
  | "database"
  | "blocks"
  | "rocket"
  | "activity"
  // UI-3 additions
  | "list-checks"
  | "shield"
  | "clock"
  | "key"
  | "git-branch"
  | "gauge"
  | "search"
  | "file-text"
  | "plug"
  | "sparkle";

export function Icon({
  name,
  className,
}: {
  name: IconName;
  className?: string;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };

  switch (name) {
    case "chat":
      return (
        <svg {...common}>
          <path d="M4 5.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9l-4.5 4V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
          <path d="M7.5 9.5h9M7.5 12.5h5.5" />
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
    case "database":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="6" rx="7" ry="2.75" />
          <path d="M5 6v6c0 1.52 3.13 2.75 7 2.75s7-1.23 7-2.75V6" />
          <path d="M5 12v6c0 1.52 3.13 2.75 7 2.75s7-1.23 7-2.75v-6" />
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
    case "rocket":
      return (
        <svg {...common}>
          <path d="M12 3c2.8 1.6 4.5 4.6 4.5 8.5 0 2-1 4-2.3 5.3L12 19l-2.2-2.2C8.5 15.5 7.5 13.5 7.5 11.5 7.5 7.6 9.2 4.6 12 3Z" />
          <circle cx="12" cy="10.5" r="1.6" />
          <path d="M9.3 16.5 7 19M14.7 16.5 17 19" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <path d="M3 12h4l2-6 4 12 2-8 2 2h4" />
        </svg>
      );
    case "list-checks":
      return (
        <svg {...common}>
          <path d="M3.5 6.5 5 8l3.5-3.5" />
          <path d="M11 6.5h9.5" />
          <path d="M3.5 12.5 5 14l3.5-3.5" />
          <path d="M11 12.5h9.5" />
          <path d="M3.5 18.5 5 20l3.5-3.5" />
          <path d="M11 18.5h9.5" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3.5 19 6.5v5.2c0 4.6-3 7.9-7 8.8-4-0.9-7-4.2-7-8.8V6.5l7-3Z" />
          <path d="M9 12l2 2 4-4.2" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.25" />
          <path d="M12 7.5V12l3.2 2" />
        </svg>
      );
    case "key":
      return (
        <svg {...common}>
          <circle cx="7.5" cy="16.5" r="3.25" />
          <path d="M9.8 14.2 17 7" />
          <path d="M14.5 9.5l2 2" />
          <path d="M17.5 6l1.8 1.8" />
        </svg>
      );
    case "git-branch":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="6" r="2" />
          <path d="M6 8v8" />
          <path d="M18 8a6 6 0 0 1-6 6H9" />
        </svg>
      );
    case "gauge":
      return (
        <svg {...common}>
          <path d="M4 15.5a8 8 0 1 1 16 0" />
          <path d="M12 15.5 16 10" />
          <circle cx="12" cy="15.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.3 15.3 20 20" />
        </svg>
      );
    case "file-text":
      return (
        <svg {...common}>
          <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
          <path d="M14 3.5V8h4" />
          <path d="M8.5 12.5h7M8.5 16h5" />
        </svg>
      );
    case "plug":
      return (
        <svg {...common}>
          <path d="M9 3v4M15 3v4" />
          <path d="M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0V7Z" />
          <path d="M12 16v5" />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...common}>
          <path d="M12 3.5c.5 3 2 4.5 5 5-3 .5-4.5 2-5 5-.5-3-2-4.5-5-5 3-.5 4.5-2 5-5Z" />
          <path d="M19 15c.25 1.4.9 2.1 2.3 2.4-1.4.25-2.05.9-2.3 2.3-.25-1.4-.9-2.05-2.3-2.3 1.4-.3 2.05-1 2.3-2.4Z" />
        </svg>
      );
    default:
      return null;
  }
}

export function IconTile({
  icon,
  hue,
  className = "",
}: {
  icon: IconName;
  hue: Hue;
  className?: string;
}) {
  const c = HUE_CLASSES[hue];
  return (
    <div
      className={`relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border ${c.tile} ${className}`}
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute -inset-2 rounded-full ${c.glow} blur-lg`}
      />
      <Icon name={icon} className={`relative h-5 w-5 ${c.icon}`} />
    </div>
  );
}
