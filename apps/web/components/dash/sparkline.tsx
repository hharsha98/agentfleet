// Shared hand-rolled SVG sparkline (UI-5 Chunk D1) — companion to
// bar-chart.tsx for compact inline trends (e.g. inside a StatCard's
// sub-line). Same "no chart library" and CSS hue-variable approach as
// BarChart — see that file's header comment for why fill/stroke use
// `var(--hue-*)` instead of a Tailwind class.
import type { Hue } from "@/components/landing/icons";

export function Sparkline({
  data,
  hue = "blue",
  width = 120,
  height = 32,
  title,
}: {
  data: number[];
  hue?: Hue;
  width?: number;
  height?: number;
  title?: string;
}) {
  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pad = 2;
  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = pad + (1 - (v - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const stroke = `var(--hue-${hue})`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ height }}
      role="img"
      preserveAspectRatio="none"
      aria-hidden={title ? undefined : "true"}
    >
      {title && <title>{title}</title>}
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
