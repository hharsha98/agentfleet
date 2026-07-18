// Full-width, pure-SVG agent-constellation background for the hero (UI-3).
// Purely decorative (aria-hidden) — sits behind the centered headline via
// absolute positioning + a mask applied by the caller in page.tsx.

import type { Hue } from "./icons";

// 9 nodes = the real built-in-agent count (see stats-strip.tsx), orbiting a
// central orchestrator node — decorative, not meant to name each agent
// (the roster section below does that with real names).
const NODES: { label: string; hue: Hue }[] = [
  { label: "R", hue: "blue" },
  { label: "W", hue: "violet" },
  { label: "A", hue: "cyan" },
  { label: "S", hue: "amber" },
  { label: "C", hue: "green" },
  { label: "M", hue: "red" },
  { label: "O", hue: "blue" },
  { label: "F", hue: "violet" },
  { label: "D", hue: "cyan" },
];

const HUE_STROKE: Record<Hue, string> = {
  blue: "var(--hue-blue)",
  violet: "var(--hue-violet)",
  cyan: "var(--hue-cyan)",
  amber: "var(--hue-amber)",
  green: "var(--hue-green)",
  red: "var(--hue-red)",
};

const CENTER = { x: 600, y: 230 };
const RX = 480;
const RY = 150;

function nodePosition(i: number, total: number) {
  // Start at the top and go clockwise so the graph reads as orbiting the
  // orchestrator rather than scattered.
  const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
  return {
    x: CENTER.x + Math.cos(angle) * RX,
    y: CENTER.y + Math.sin(angle) * RY,
  };
}

export function AgentNetwork() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1200 460"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
    >
      <g>
        {NODES.map((node, i) => {
          const pos = nodePosition(i, NODES.length);
          // Control point pulled toward the center so edges arc gently
          // instead of running as straight spokes.
          const cx = CENTER.x + (pos.x - CENTER.x) * 0.55;
          const cy = CENTER.y + (pos.y - CENTER.y) * 0.55 - 18;
          return (
            <path
              key={`edge-${node.label}-${i}`}
              d={`M ${CENTER.x} ${CENTER.y} Q ${cx} ${cy} ${pos.x} ${pos.y}`}
              fill="none"
              stroke={HUE_STROKE[node.hue]}
              strokeWidth={1.5}
              strokeLinecap="round"
              pathLength={100}
              className="network-edge"
              style={{ animationDelay: `${i * 0.7}s` }}
              opacity={0.35}
            />
          );
        })}
      </g>

      <g>
        {NODES.map((node, i) => {
          const pos = nodePosition(i, NODES.length);
          return (
            <g
              key={`node-${node.label}-${i}`}
              className="network-node"
              style={{ animationDelay: `${i * 0.7 + 0.9}s` }}
            >
              <circle
                cx={pos.x}
                cy={pos.y}
                r={16}
                fill={HUE_STROKE[node.hue]}
                fillOpacity={0.12}
                stroke={HUE_STROKE[node.hue]}
                strokeWidth={1.25}
              />
              <text
                x={pos.x}
                y={pos.y + 4}
                textAnchor="middle"
                fontSize={11}
                fontFamily="var(--font-mono)"
                fill={HUE_STROKE[node.hue]}
              >
                {node.label}
              </text>
            </g>
          );
        })}

        {/* Central orchestrator node, brighter and larger than the rest. */}
        <circle
          cx={CENTER.x}
          cy={CENTER.y}
          r={24}
          fill="var(--accent)"
          fillOpacity={0.16}
          stroke="var(--accent)"
          strokeWidth={1.5}
        />
        <text
          x={CENTER.x}
          y={CENTER.y + 4}
          textAnchor="middle"
          fontSize={11}
          fontFamily="var(--font-mono)"
          fill="var(--accent)"
        >
          ORCH
        </text>
      </g>
    </svg>
  );
}
