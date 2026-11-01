"use client";

import * as React from "react";
import { formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { useChartSync } from "@/components/chart-sync";
import { GrainFilter } from "@/components/ui/grain";

export type SparklineFormat = "number" | "percent" | "decimal" | "duration";

type SparklineProps = {
  values: number[];
  className?: string;
  color?: string;
  strokeWidth?: number;
  /** If true, renders as mini bar chart instead of a line */
  variant?: "line" | "bar";
  /** ISO timestamps, one per value, shown in the hover tooltip in the viewer's timezone. */
  timestamps?: string[];
  /** Whether each point is an hour or a day (picks the tooltip's date format). */
  granularity?: "hour" | "day";
  /** What the line measures, e.g. "Visitors". Shown in the tooltip. */
  name?: string;
  format?: SparklineFormat;
  /** Shown on hover while there is nothing to plot yet. */
  emptyHint?: string;
  /** Follow, and drive, the hover of other charts in the same ChartSyncProvider. */
  synced?: boolean;
};

const VIEW_W = 120;
const VIEW_H = 32;
// Fixed, gently varying heights for the "nothing yet" ghost so it reads as a placeholder chart.
const GHOST = [0.35, 0.5, 0.42, 0.62, 0.48, 0.7, 0.55, 0.4, 0.58, 0.46, 0.64, 0.5];

function formatValue(value: number, format: SparklineFormat): string {
  switch (format) {
    case "percent":
      return formatPercent(value);
    case "decimal":
      return value.toFixed(1);
    case "duration":
      return formatDuration(value);
    default:
      return formatNumber(value);
  }
}

function formatWhen(iso: string | undefined, granularity: "hour" | "day"): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(
    "en",
    granularity === "hour"
      ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { weekday: "short", month: "short", day: "numeric" }
  ).format(date);
}

export function Sparkline({
  values,
  className = "",
  color = "var(--sparkline)",
  strokeWidth = 1.5,
  variant = "bar",
  timestamps,
  granularity = "day",
  name,
  format = "number",
  emptyHint = "Fills in as your traffic grows",
  synced = false,
}: SparklineProps) {
  const [hover, setHover] = React.useState<number | null>(null);
  const sync = useChartSync();
  const linked = synced ? sync : null;
  const id = React.useId().replace(/:/g, "");

  const hasData = values.length >= 2 && values.some((v) => v > 0);
  const slots = hasData ? values.length : GHOST.length;

  const indexFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return 0;
    const ratio = Math.min(0.999, Math.max(0, (event.clientX - rect.left) / rect.width));
    return Math.floor(ratio * slots);
  };

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const index = indexFromEvent(event);
    setHover(index);
    if (hasData) linked?.set(index);
  };
  const handlers = {
    onPointerMove: move,
    onPointerEnter: move,
    onPointerLeave: () => {
      setHover(null);
      linked?.set(null);
    },
  };

  // Nothing to plot yet: muted placeholder, with a hint on hover.
  if (!hasData) {
    return (
      <div
        className={`relative h-8 w-full ${className}`}
        role="img"
        aria-label={`${name ? `${name}: ` : ""}no data yet. ${emptyHint}`}
        {...handlers}
      >
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
          {variant === "bar" ? (
            GHOST.map((h, i) => {
              const gap = 1;
              const barW = (VIEW_W - gap * (GHOST.length - 1)) / GHOST.length;
              const barH = h * VIEW_H * 0.7;
              return (
                <rect
                  key={i}
                  x={i * (barW + gap)}
                  y={VIEW_H - barH}
                  width={barW}
                  height={barH}
                  rx={1}
                  fill="#ffffff"
                  opacity={hover === null ? 0.05 : hover === i ? 0.14 : 0.07}
                  style={{ transition: "opacity 120ms ease" }}
                />
              );
            })
          ) : (
            <line
              x1={0}
              x2={VIEW_W}
              y1={VIEW_H - 3}
              y2={VIEW_H - 3}
              stroke="rgba(255,255,255,0.14)"
              strokeWidth={1.25}
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {hover !== null && <Tooltip pct={((hover + 0.5) / slots) * 100} muted title="No data yet" detail={emptyHint} />}
      </div>
    );
  }

  const max = Math.max(...values, 1);
  // Own hover wins; otherwise follow the linked chart (highlight only, no tooltip).
  const followed = hover === null && linked && linked.index !== null && linked.index < values.length ? linked.index : null;
  const point = hover ?? followed;

  const tooltip =
    hover !== null ? (
      <Tooltip
        pct={((hover + 0.5) / values.length) * 100}
        color={color}
        title={formatWhen(timestamps?.[hover], granularity) ?? `Point ${hover + 1}`}
        detail={`${name ? `${name}: ` : ""}${formatValue(values[hover] ?? 0, format)}`}
      />
    ) : null;

  if (variant === "bar") {
    const gap = 1;
    const barW = Math.max(1, (VIEW_W - gap * (values.length - 1)) / values.length);
    return (
      <div className={`relative h-8 w-full ${className}`} {...handlers}>
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" className="h-8 w-full overflow-visible" aria-hidden>
          <defs>
            <GrainFilter id={`gr-${id}`} width={VIEW_W} height={VIEW_H} />
          </defs>
          <g filter={`url(#gr-${id})`}>
          {values.map((value, index) => {
            const barH = Math.max(2, (value / max) * VIEW_H);
            const base = 0.35 + 0.65 * (value / max);
            const opacity = point === null ? base : point === index ? 1 : base * 0.45;
            return (
              <rect
                key={index}
                x={index * (barW + gap)}
                y={VIEW_H - barH}
                width={barW}
                height={barH}
                rx={1}
                fill={value === 0 ? "rgba(255,255,255,0.12)" : color}
                opacity={value === 0 ? (point === index ? 0.9 : 0.6) : opacity}
                style={{ transition: "opacity 120ms ease" }}
              />
            );
          })}
          </g>
        </svg>
        {tooltip}
      </div>
    );
  }

  // Line variant
  const padY = 2;
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const pts = values.map((value, index) => ({
    x: (index / (values.length - 1)) * VIEW_W,
    y: VIEW_H - padY - ((value - min) / range) * (VIEW_H - padY * 2),
  }));
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${VIEW_W} ${VIEW_H} L0 ${VIEW_H} Z`;
  const active = point !== null ? pts[point] : null;

  return (
    <div className={`relative h-8 w-full ${className}`} {...handlers}>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" className="h-8 w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <GrainFilter id={`gr-${id}`} width={VIEW_W} height={VIEW_H} />
        </defs>
        <path d={areaPath} fill={`url(#sg-${id})`} filter={`url(#gr-${id})`} />
        <path
          filter={`url(#gr-${id})`}
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {active && (
          <line
            x1={active.x}
            x2={active.x}
            y1={0}
            y2={VIEW_H}
            stroke="rgba(255,255,255,0.22)"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {active && (
        <span
          aria-hidden
          className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-950"
          style={{ left: `${(active.x / VIEW_W) * 100}%`, top: `${(active.y / VIEW_H) * 100}%`, background: color }}
        />
      )}
      {tooltip}
    </div>
  );
}

function Tooltip({
  pct,
  title,
  detail,
  color,
  muted = false,
}: {
  pct: number;
  title: string;
  detail: string;
  color?: string;
  muted?: boolean;
}) {
  // Keep the bubble inside the card at both ends instead of centring it on edge bars.
  const left = Math.min(82, Math.max(18, pct));
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full z-20 mb-2 w-max max-w-[190px] -translate-x-1/2 rounded-lg border border-white/[0.1] bg-zinc-900/95 px-3 py-2 text-left shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)] backdrop-blur"
      style={{ left: `${left}%` }}
    >
      <p className="text-xs font-medium text-zinc-400">{title}</p>
      <p className={`mt-0.5 flex items-center gap-2 text-xs ${muted ? "text-zinc-300" : "font-medium tabular-nums text-zinc-100"}`}>
        {!muted && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />}
        <span className={muted ? "leading-snug" : ""}>{detail}</span>
      </p>
    </div>
  );
}
