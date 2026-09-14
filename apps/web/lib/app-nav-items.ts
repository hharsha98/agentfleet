/** Single source of truth for app-shell destinations.

The hosted demo looked Chat-only when these links were missing from an
older web image, or when they existed but client pages failed silently.
E2E imports this list so a deploy without /agents /workflows /missions
cannot go green.
*/
export const PRIMARY_NAV_ITEMS = [
  { href: "/chat", label: "Chat" },
  { href: "/missions", label: "Missions" },
  { href: "/workflows", label: "Workflows" },
  { href: "/agents", label: "Agents" },
  { href: "/documents", label: "Documents" },
] as const;

export const OVERFLOW_NAV_ITEMS = [
  { href: "/evals", label: "Evals" },
  { href: "/guardrails", label: "Guardrails" },
  { href: "/usage", label: "Usage" },
  { href: "/automations", label: "Automations" },
  { href: "/playground", label: "Playground" },
  { href: "/voice", label: "Voice" },
  { href: "/templates", label: "Templates" },
  { href: "/changelog", label: "Changelog" },
] as const;

export const ALL_APP_NAV_ITEMS = [...PRIMARY_NAV_ITEMS, ...OVERFLOW_NAV_ITEMS];
