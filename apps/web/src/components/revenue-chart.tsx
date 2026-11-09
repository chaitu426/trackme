"use client";

import * as React from "react";
import { nearestIndex, niceMax, smoothPath } from "@/lib/chart-path";
import { formatMoney } from "@/lib/payments-view";

export interface RevenuePoint {
  day: string;
  revenueMinor: number;
  paid: number;
}

const H = 240;
/** The value labels live in their own gutter on the left, so nothing is drawn over the line or its peaks. */
const PAD = { top: 12, right: 12, bottom: 28, left: 56 };
const GRID = 4;
const MIN_W = 320;

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T | null>(null);
  const [w, setW] = React.useState(760);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.max(MIN_W, Math.round(el.getBoundingClientRect().width)));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Evenly spaced day labels (at most `max`), always including the first and last day. */
function tickIndexes(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: max }, (_, i) => Math.round((i / (max - 1)) * (n - 1)));
}

/**
 * The page's one rich chart: revenue by day as a smooth line with a soft fill, the previous period as a dashed neutral line,
 * a crosshair and tooltip on hover (arrow keys on focus). It is drawn at the container's real pixel width, so type stays the
 * same size at any width; the value axis sits in its own gutter. The line draws once. The accent is the current period; the
 * comparison and the grid are neutral steps.
 */
export function RevenueChart({ points, previous, currency }: { points: RevenuePoint[]; previous: RevenuePoint[]; currency: string }) {
  const [wrap, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const ref = React.useRef<SVGSVGElement>(null);
  const n = points.length;
  // The wrapper has 20px of padding on each side; the plot is drawn at exactly the width that is left.
  const SW = W - 40;
  const innerW = SW - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = React.useMemo(() => niceMax(Math.max(...points.map((p) => p.revenueMinor), ...previous.map((p) => p.revenueMinor), 1)), [points, previous]);

  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  // The paths depend on the data and the width, not on the hover, so hovering does not recompute them.
  const { line, prevLine, area } = React.useMemo(() => {
    const px = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const py = (v: number) => PAD.top + innerH - (v / max) * innerH;
    const l = smoothPath(points.map((p, i) => ({ x: px(i), y: py(p.revenueMinor) })));
    const pl = smoothPath(previous.slice(0, n).map((p, i) => ({ x: px(i), y: py(p.revenueMinor) })));
    return { line: l, prevLine: pl, area: n > 1 ? `${l}L${px(n - 1)},${PAD.top + innerH}L${px(0)},${PAD.top + innerH}Z` : "" };
  }, [points, previous, n, innerW, innerH, max]);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setHover(nearestIndex(e.clientX - box.left - PAD.left, innerW, n));
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
    else if (e.key === "Escape") setHover(null);
  }

  const hp = hover === null ? null : points[hover];
  const hv = hover === null ? null : previous[hover];
  const tipX = hover === null ? 0 : x(hover);
  const flip = tipX > SW - 190;
  const ticks = tickIndexes(n, W < 560 ? 3 : W < 900 ? 5 : 7);

  return (
    <div ref={wrap} className="relative px-5 pb-5">
      <div className="relative">
        <svg
          ref={ref}
          width={SW}
          height={H}
          viewBox={`0 0 ${SW} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={`Revenue per day in ${currency}. Use the arrow keys to move between days.`}
          className="block touch-pan-y outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={onKey}
        >
          <defs>
            <linearGradient id="rev-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#ededed" stopOpacity="0.14" />
              <stop offset="1" stopColor="#ededed" stopOpacity="0" />
            </linearGradient>
          </defs>

          {Array.from({ length: GRID + 1 }, (_, i) => {
            const gy = PAD.top + (innerH / GRID) * i;
            const value = max - (max / GRID) * i;
            return (
              <g key={i}>
                <line x1={PAD.left} x2={SW - PAD.right} y1={gy} y2={gy} stroke="rgba(237,237,237,0.06)" />
                <text x={PAD.left - 10} y={gy + 3.5} fontSize="11" textAnchor="end" fill="#6e6e74" fontFamily="var(--font-mono)">
                  {value === 0 ? "0" : formatMoney(value, currency, true)}
                </text>
              </g>
            );
          })}

          {prevLine && <path d={prevLine} fill="none" stroke="#6e6e74" strokeWidth="1.25" strokeDasharray="3 4" />}
          {area && <path d={area} fill="url(#rev-fill)" className="fade-late" />}
          {line && <path d={line} pathLength={1} fill="none" stroke="#ededed" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="draw-line" />}

          {ticks.map((i) => (
            <text key={i} x={x(i)} y={H - 8} fontSize="11" fill="#6e6e74" fontFamily="var(--font-mono)" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
              {points[i]?.day.slice(5)}
            </text>
          ))}

          {hover !== null && hp && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="rgba(237,237,237,0.25)" />
              {hv && <circle cx={x(hover)} cy={y(hv.revenueMinor)} r="3" fill="#19191b" stroke="#6e6e74" strokeWidth="1.25" />}
              <circle cx={x(hover)} cy={y(hp.revenueMinor)} r="4" fill="#19191b" stroke="#ededed" strokeWidth="1.75" />
            </g>
          )}
        </svg>

        {hp && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-2 z-10 w-44 rounded-lg border border-border bg-raised px-3 py-2 text-xs shadow-float"
            style={{ left: flip ? tipX - 184 : tipX + 12 }}
          >
            <p className="font-mono text-zinc-400">{hp.day}</p>
            <p className="mt-0.5 font-mono text-sm tabular-nums text-zinc-50">{formatMoney(hp.revenueMinor, currency)}</p>
            <p className="text-zinc-500">
              {hp.paid} payment{hp.paid === 1 ? "" : "s"}
            </p>
            {hv && (
              <p className="mt-1 flex justify-between border-t border-white/[0.06] pt-1 text-zinc-500">
                <span>Before</span>
                <span className="font-mono tabular-nums text-zinc-300">{formatMoney(hv.revenueMinor, currency)}</span>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-5 text-xs text-zinc-500" style={{ paddingLeft: PAD.left }}>
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-4 rounded bg-zinc-200" aria-hidden="true" />
          This period
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="16" height="2" aria-hidden="true">
            <line x1="0" x2="16" y1="1" y2="1" stroke="#6e6e74" strokeWidth="1.5" strokeDasharray="3 3" />
          </svg>
          Previous period
        </span>
      </div>
    </div>
  );
}
