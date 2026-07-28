// Moved out of missions/page.tsx (UI-6) so the workflow graph's node chips
// can format an agent slug ("deep-research") into a display name ("Deep
// Research") identically to the board's TaskCard chip — imported back into
// missions/page.tsx. No behavior change.
export function agentDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
