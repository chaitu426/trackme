"use client";

import * as React from "react";
import { nearestIndex, niceMax, smoothPath } from "@/lib/chart-path";
import { formatMoney } from "@/lib/payments-view";

export interface RevenuePoint {
  day: string;
  revenueMinor: number;
  paid: number;
}

const W = 760;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 24, left: 8 };
const GRID = 4;

/**
 * The page's one rich chart. Revenue by day as a smooth line with a soft fill, the previous period as a dashed neutral line
 * for comparison, a crosshair with a tooltip on hover (and on keyboard focus, one day at a time with the arrow keys).
 * The line draws once when it appears. Colour: the accent is the current period; everything else is a neutral step.
 */
export function RevenueChart({ points, previous, currency }: { points: RevenuePoint[]; previous: RevenuePoint[]; currency: string }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const ref = React.useRef<SVGSVGElement>(null);
  const n = points.length;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = React.useMemo(() => niceMax(Math.max(...points.map((p) => p.revenueMinor), ...previous.map((p) => p.revenueMinor), 1)), [points, previous]);

  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  // The paths depend only on the data, so hovering (which re-renders on every new day) does not recompute them.
  const { line, prevLine, area } = React.useMemo(() => {
    const px = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const py = (v: number) => PAD.top + innerH - (v / max) * innerH;
    const l = smoothPath(points.map((p, i) => ({ x: px(i), y: py(p.revenueMinor) })));
    const pl = smoothPath(previous.slice(0, n).map((p, i) => ({ x: px(i), y: py(p.revenueMinor) })));
    return { line: l, prevLine: pl, area: n > 1 ? `${l}L${px(n - 1)},${PAD.top + innerH}L${px(0)},${PAD.top + innerH}Z` : "" };
  }, [points, previous, n, innerW, innerH, max]);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = ref.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setHover(nearestIndex(((e.clientX - box.left) / box.width) * W - PAD.left, innerW, n));
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
    else if (e.key === "Escape") setHover(null);
  }

  const hp = hover === null ? null : points[hover];
  const hv = hover === null ? null : previous[hover];
  const tipLeft = hover === null ? 0 : Math.min(86, Math.max(14, (x(hover) / W) * 100));

  return (
    <div className="relative px-5 pb-5">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        tabIndex={0}
        aria-label={`Revenue per day in ${currency}. Use the arrow keys to move between days.`}
        className="w-full touch-pan-y outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={onKey}
      >
        {Array.from({ length: GRID + 1 }, (_, i) => {
          const gy = PAD.top + (innerH / GRID) * i;
          return (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={gy} y2={gy} stroke="rgba(237,237,237,0.06)" />
              {i < GRID && (
                <text x={W - PAD.right} y={gy - 4} fontSize="10" textAnchor="end" fill="#6e6e74" fontFamily="var(--font-mono)">
                  {formatMoney(max - (max / GRID) * i, currency, true)}
                </text>
              )}
            </g>
          );
        })}

        {prevLine && <path d={prevLine} fill="none" stroke="#6e6e74" strokeWidth="1.25" strokeDasharray="3 4" />}
        {area && <path d={area} fill="url(#rev-fill)" className="fade-late" />}
        <defs>
          <linearGradient id="rev-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ededed" stopOpacity="0.14" />
            <stop offset="1" stopColor="#ededed" stopOpacity="0" />
          </linearGradient>
        </defs>
        {line && <path d={line} pathLength={1} fill="none" stroke="#ededed" strokeWidth="1.75" strokeLinecap="round" className="draw-line" />}

        {hover !== null && hp && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="rgba(237,237,237,0.25)" />
            {hv && <circle cx={x(hover)} cy={y(hv.revenueMinor)} r="3" fill="#19191b" stroke="#6e6e74" strokeWidth="1.25" />}
            <circle cx={x(hover)} cy={y(hp.revenueMinor)} r="4" fill="#19191b" stroke="#ededed" strokeWidth="1.75" />
          </g>
        )}

        <text x={PAD.left} y={H - 6} fontSize="10" fill="#6e6e74" fontFamily="var(--font-mono)">{points[0]?.day.slice(5)}</text>
        <text x={W - PAD.right} y={H - 6} fontSize="10" fill="#6e6e74" fontFamily="var(--font-mono)" textAnchor="end">{points[n - 1]?.day.slice(5)}</text>
      </svg>

      {hp && (
        <div
          className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-lg border border-border bg-raised px-3 py-2 text-xs shadow-float"
          style={{ left: `${tipLeft}%` }}
          aria-hidden="true"
        >
          <p className="font-mono text-zinc-400">{hp.day}</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums text-zinc-50">{formatMoney(hp.revenueMinor, currency)}</p>
          <p className="text-zinc-500">{hp.paid} payment{hp.paid === 1 ? "" : "s"}</p>
          {hv && <p className="mt-1 border-t border-white/[0.06] pt-1 text-zinc-500">Before: <span className="font-mono tabular-nums text-zinc-300">{formatMoney(hv.revenueMinor, currency)}</span></p>}
        </div>
      )}

      <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-zinc-200" aria-hidden="true" />This period</span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="2" aria-hidden="true"><line x1="0" x2="16" y1="1" y2="1" stroke="#6e6e74" strokeWidth="1.5" strokeDasharray="3 3" /></svg>
          Previous period
        </span>
      </div>
    </div>
  );
}
