// Reference-parity three-level section header (UI-5 Chunk B): a colored
// mono eyebrow (with an optional small icon), a big statement h2, and a
// muted tagline capped at max-w-2xl. Applied to every major landing
// section so the page reads as one consistent system instead of each
// section inventing its own header treatment.

import { HUE_CLASSES, Icon, type Hue, type IconName } from "./icons";

export function SectionHeader({
  eyebrow,
  hue,
  icon,
  title,
  tagline,
  className = "",
}: {
  eyebrow: string;
  hue: Hue;
  icon?: IconName;
  title: string;
  tagline?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <span
        className={`flex items-center gap-1.5 font-mono text-xs font-medium uppercase tracking-[0.16em] ${HUE_CLASSES[hue].icon}`}
      >
        {icon ? <Icon name={icon} className="h-3.5 w-3.5" /> : null}
        {eyebrow}
      </span>
      {/* font-display (Instrument Serif) — see app/page.tsx's hero h1 for
          why font-normal rather than font-medium. This component is imported
          only by app/page.tsx and four components/landing/* siblings, so the
          serif stays on the landing page and never reaches the in-app
          screens, which stay entirely on Geist. */}
      <h2 className="font-display text-3xl font-normal tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      {tagline ? <p className="max-w-2xl text-muted">{tagline}</p> : null}
    </div>
  );
}
