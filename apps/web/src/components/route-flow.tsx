"use client";

import * as React from "react";
import type { TraceStep } from "@trackme/analytics";
import { formatNumber } from "@/lib/format";
import { NEUTRAL_COLOR, pageColor } from "@/lib/page-color";

const WIDTH = 1000;
const HEIGHT = 300;
const NODE_W = 12;
const PAD_X = 56;
const PAD_TOP = 48;
const PAD_BOTTOM = 14;

function pct(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const v = (part / whole) * 100;
  if (v > 0 && v < 0.1) return "<0.1%";
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}%`;
}

function clip(text: string, max: number): string {
  return text.length > max ? `…${text.slice(text.length - (max - 1))}` : text;
}

/**
 * One route drawn like the Visitor flow: a column per step, a ribbon for the sessions that
 * carried on to the next page, and a faded stub for the ones that went elsewhere or left.
 */
export function RouteFlow({ steps }: { steps: TraceStep[] }) {
  const [hovered, setHovered] = React.useState<number | null>(null);

  const entered = steps[0]?.sessions ?? 0;
  if (steps.length < 2 || entered === 0) return null;

  const scale = (HEIGHT - PAD_TOP - PAD_BOTTOM) / entered;
  const span = (WIDTH - PAD_X * 2 - NODE_W) / (steps.length - 1);

  const nodes = steps.map((step, i) => ({
    step,
    x: PAD_X + i * span,
    y: PAD_TOP,
    h: Math.max(step.sessions * scale, 3),
    color: pageColor(step.page),
  }));

  const dim = (i: number) => (hovered === null || hovered === i ? 1 : 0.28);

  return (
    <div className="relative overflow-x-auto rounded-lg bg-black/20" onPointerLeave={() => setHovered(null)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full min-w-[640px]"
        role="img"
        aria-label={`${formatNumber(entered)} sessions followed this route across ${steps.length} pages`}
      >
        <defs>
        </defs>

        {nodes.map((n, i) => (
          <text
            key={`h-${i}`}
            x={n.x + NODE_W / 2}
            y={14}
            textAnchor="middle"
            className="fill-zinc-600"
            style={{ fontSize: 12 }}
          >
            {i === 0 ? "Entry" : `Step ${i + 1}`}
          </text>
        ))}

        <g fill="none">
          {nodes.slice(0, -1).map((n, i) => {
            const next = nodes[i + 1]!;
            const carried = Math.max(next.step.sessions * scale, 1.5);
            const lost = Math.max(n.h - carried, 0);
            const x0 = n.x + NODE_W;
            const x1 = next.x;
            const mid = (x0 + x1) / 2;
            const y = PAD_TOP + carried / 2;
            const lostY = PAD_TOP + carried + lost / 2;
            return (
              <g key={`r-${i}`} opacity={hovered === null || hovered === i || hovered === i + 1 ? 1 : 0.3} style={{ transition: "opacity 160ms ease" }}>
                <path d={`M${x0} ${y} C${mid} ${y}, ${mid} ${y}, ${x1} ${y}`} stroke={n.color} strokeWidth={carried} opacity={0.34} />
                {lost >= 1 && (
                  <path
                    d={`M${x0} ${lostY} C${x0 + 40} ${lostY}, ${x0 + 52} ${lostY + 10}, ${x0 + 70} ${lostY + 14}`}
                    stroke={NEUTRAL_COLOR}
                    strokeWidth={lost}
                    strokeLinecap="butt"
                    opacity={0.2}
                  />
                )}
              </g>
            );
          })}
        </g>

        {nodes.map((n, i) => {
          const last = i === nodes.length - 1;
          return (
            <g
              key={`n-${i}`}
              opacity={dim(i)}
              style={{ transition: "opacity 160ms ease", cursor: "default" }}
              onPointerEnter={() => setHovered(i)}
            >
              <title>
                {`${n.step.page}\n${formatNumber(n.step.sessions)} sessions · ${pct(n.step.sessions, entered)} of entry`}
              </title>
              <rect x={n.x - 6} y={n.y - 26} width={NODE_W + 12} height={n.h + 26} fill="transparent" />
              <rect x={n.x} y={n.y} width={NODE_W} height={n.h} rx={3} fill={n.color} />
              <text
                x={last ? n.x + NODE_W : n.x}
                y={n.y - 15}
                textAnchor={last ? "end" : "start"}
                className="pointer-events-none fill-zinc-400"
                style={{ fontSize: 10, fontFamily: "var(--font-mono), monospace" }}
              >
                {clip(n.step.page, 22)}
              </text>
              <text
                x={last ? n.x + NODE_W : n.x}
                y={n.y - 4}
                textAnchor={last ? "end" : "start"}
                className="pointer-events-none fill-zinc-100"
                style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
              >
                {pct(n.step.sessions, entered)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
