// Shared hand-rolled SVG bar chart (UI-5 Chunk D1) — no chart library
// dependency, matches the "hand-inlined SVG" convention already used by
// components/landing/icons.tsx. Accessible via an SVG <title>/<desc> pair
// (read by screen readers as the chart's accessible name/description) and
// a native per-bar <title> tooltip on hover. Grid lines use the same
// --hairline color as every other border in the app; bars use the CSS hue
// custom properties defined in app/globals.css (--hue-blue etc.) directly,
// rather than a Tailwind class, since a dynamically-built class name like
// `fill-hue-${hue}` can't be seen by Tailwind's JIT scanner at build time.
import type { Hue } from "@/components/landing/icons";

export type BarChartDatum = {
  label: string;
  value: number;
  tooltip?: string;
};

export function BarChart({
  data,
  hue = "blue",
  title,
  desc,
  height = 140,
  valueFormatter = (v: number) => v.toLocaleString(),
  emptyLabel = "No data yet.",
}: {
  data: BarChartDatum[];
  hue?: Hue;
  title: string;
  desc?: string;
  height?: number;
  valueFormatter?: (v: number) => string;
  emptyLabel?: string;
}) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-hairline"
        style={{ height }}
      >
        <p className="text-xs text-muted">{emptyLabel}</p>
      </div>
    );
  }

  const max = Math.max(1, ...data.map((d) => d.value));
  const barCount = data.length;
  const width = Math.max(barCount * 26, 260);
  const gap = Math.min(6, width / barCount / 4);
  const barWidth = (width - gap * (barCount - 1)) / barCount;
  const plotBottom = height - 18;
  const plotHeight = plotBottom - 8;
  const gridFractions = [0.25, 0.5, 0.75, 1];
  const labelStride = Math.max(1, Math.ceil(barCount / 7));
  const fill = `var(--hue-${hue})`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ height }}
      role="img"
      preserveAspectRatio="none"
    >
      <title>{title}</title>
      {desc && <desc>{desc}</desc>}
      {gridFractions.map((g) => {
        const y = plotBottom - g * plotHeight;
        return (
          <line
            key={g}
            x1={0}
            x2={width}
            y1={y}
            y2={y}
            stroke="var(--hairline)"
            strokeWidth={1}
          />
        );
      })}
      {data.map((d, i) => {
        const barHeight = Math.max(1.5, (d.value / max) * plotHeight);
        const x = i * (barWidth + gap);
        const y = plotBottom - barHeight;
        return (
          <g key={`${d.label}-${i}`}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx={2} fill={fill} opacity={0.85}>
              <title>{d.tooltip ?? `${d.label}: ${valueFormatter(d.value)}`}</title>
            </rect>
            {i % labelStride === 0 && (
              <text
                x={x + barWidth / 2}
                y={height - 4}
                textAnchor="middle"
                fontSize={8}
                fill="var(--muted)"
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
