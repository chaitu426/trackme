"use client";

import { useState } from "react";
import { useChartSync } from "@/components/chart-sync";
import { MatrixArt } from "@/components/ui/matrix-art";
import type { TimeSeriesPoint } from "@trackme/analytics";

type SeriesKey = "visitors" | "sessions" | "pageviews";

// One accent leads. Whatever it is compared with sits in a neutral step.
const ACCENT = "#ededed";
const NEUTRAL = "#8b8b92";
const seriesColor = (key: SeriesKey, primary: SeriesKey) => (key === primary ? ACCENT : NEUTRAL);

export function TimeSeriesChart({
  points,
  primary = "visitors",
  secondary = "sessions",
}: {
  points: TimeSeriesPoint[];
  primary?: SeriesKey;
  secondary?: SeriesKey | null;
}) {
  const sync = useChartSync();
  const [localHover, setLocalHover] = useState<number | null>(null);
  // Inside a ChartSyncProvider the hover is shared with the KPI sparklines, both ways.
  const hoverIndex = sync ? sync.index : localHover;
  const setHoverIndex = sync ? sync.set : setLocalHover;

  const hasTraffic = points.some((p) => p.visitors > 0 || p.sessions > 0 || p.pageviews > 0);
  if (!points.length || !hasTraffic) {
    // Day one: the same glyph picture the landing page uses for traffic, so the card already
    // shows what it will become.
    return (
      <MatrixArt variant="ridge" className="mx-5 h-[320px]" strength={0.7}>
        <p className="text-sm font-medium text-zinc-200">No traffic yet</p>
        <p className="mt-1 max-w-xs text-xs leading-4 text-zinc-400">
          Visitors and sessions chart here as soon as your site starts sending events.
        </p>
      </MatrixArt>
    );
  }

  const width = 800;
  const height = 320;
  const pad = { top: 16, right: 24, bottom: 36, left: 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const primaryValues = points.map((p) => p[primary]);
  const secondaryValues = secondary ? points.map((p) => p[secondary]) : [];
  const max = Math.max(...primaryValues, ...secondaryValues, 1);
  const yTicks = buildTicks(max);

  const primaryColor = ACCENT;
  const secondaryColor = secondary ? seriesColor(secondary, primary) : NEUTRAL;

  const toPoints = (values: number[]) =>
    values.map((value, index) => {
      const x = pad.left + (index / Math.max(values.length - 1, 1)) * innerW;
      const y = pad.top + innerH - (value / max) * innerH;
      return { x, y, value };
    });

  const primaryPts = toPoints(primaryValues);
  const secondaryPts = secondary ? toPoints(secondaryValues) : [];

  const primaryPath = smoothPath(primaryPts);
  const secondaryPath = secondaryPts.length ? smoothPath(secondaryPts) : "";
  const primaryAreaPath = areaPath(primaryPts, pad, innerH);
  
  const labelStep = Math.max(1, Math.ceil(points.length / 7));
  const primaryId = `grad-primary-${primary}`;

  const hoveredPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const hoveredPrimaryPt = hoverIndex !== null ? primaryPts[hoverIndex] : null;

  return (
    <div className="relative w-full overflow-hidden select-none">
      {/* Top Legend Bar & Hover Live Indicator */}
      <div className="flex h-8 items-center justify-between px-5 pb-2 text-xs">
        <div className="flex items-center gap-4">
          <LegendDot color={primaryColor} label={capitalize(primary)} />
          {secondary && <LegendDot color={secondaryColor} label={capitalize(secondary)} />}
        </div>
        {hoveredPoint ? (
          <div className="flex items-center gap-4 font-mono text-xs tabular-nums text-zinc-200">
            <span className="text-zinc-500">{formatLabel(hoveredPoint.timestamp)}</span>
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: primaryColor }} />
              {hoveredPoint[primary].toLocaleString()}
            </span>
            {secondary && (
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: secondaryColor }} />
                {hoveredPoint[secondary].toLocaleString()}
              </span>
            )}
          </div>
        ) : null}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[320px] w-full overflow-visible"
        role="img"
        aria-label="Traffic over time"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={primaryId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryColor} stopOpacity="0.16" />
            <stop offset="85%" stopColor={primaryColor} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines & Y labels */}
        {yTicks.map((tick) => {
          const y = pad.top + innerH - (tick / max) * innerH;
          return (
            <g key={tick}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                stroke="rgba(237,237,237,0.06)"
              />
              <text
                x={pad.left - 10}
                y={y + 3.5}
                textAnchor="end"
                className="fill-zinc-500 font-mono"
                style={{ fontSize: 12 }}
              >
                {formatAxis(tick)}
              </text>
            </g>
          );
        })}

        <path d={primaryAreaPath} fill={`url(#${primaryId})`} />

        {/* Secondary curve line */}
        {secondaryPath && (
          <path
            d={secondaryPath}
            fill="none"
            stroke={secondaryColor}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.7}
          />
        )}

        {/* Primary curve line */}
        <path
          d={primaryPath}
          fill="none"
          stroke={primaryColor}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Vertical hover guide line */}
        {hoveredPrimaryPt && (
          <line
            x1={hoveredPrimaryPt.x}
            x2={hoveredPrimaryPt.x}
            y1={pad.top}
            y2={pad.top + innerH}
            stroke="rgba(237,237,237,0.16)"
            strokeWidth={1}
          />
        )}

        {/* Interactive column hover hitboxes */}
        {primaryPts.map((pt, index) => {
          const isHovered = hoverIndex === index;
          const colWidth = innerW / Math.max(points.length - 1, 1);

          return (
            <g key={points[index]!.timestamp}>
              <rect
                x={pt.x - colWidth / 2}
                y={pad.top}
                width={colWidth}
                height={innerH}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoverIndex(index)}
              />

              {/* Active point markers */}
              {isHovered && (
                <>
                  {secondaryPts[index] && (
                    <circle
                      cx={secondaryPts[index]!.x}
                      cy={secondaryPts[index]!.y}
                      r={4}
                      fill="#19191b"
                      stroke={secondaryColor}
                    />
                  )}
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={4.5}
                    fill="#19191b"
                    stroke={primaryColor}
                  />
                </>
              )}
            </g>
          );
        })}

        {/* X-axis time labels */}
        {points.map((point, index) =>
          index % labelStep === 0 || index === points.length - 1 ? (
            <text
              key={`label-${point.timestamp}`}
              x={pad.left + (index / Math.max(points.length - 1, 1)) * innerW}
              y={height - 12}
              textAnchor="middle"
              className="fill-zinc-500 font-mono"
              style={{ fontSize: 12 }}
            >
              {formatLabel(point.timestamp)}
            </text>
          ) : null,
        )}

        {/* Bottom baseline */}
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + innerH}
          y2={pad.top + innerH}
          stroke="rgba(237,237,237,0.1)"
        />
      </svg>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="text-xs text-zinc-400">{label}</span>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) {
    return `M${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)} L${pts[1]!.x.toFixed(1)} ${pts[1]!.y.toFixed(1)}`;
  }
  let d = `M${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const tension = 0.3;
    const prev = pts[i - 1] ?? p0;
    const next = pts[i + 2] ?? p1;
    const cp1x = p0.x + (p1.x - prev.x) * tension;
    const cp1y = p0.y + (p1.y - prev.y) * tension;
    const cp2x = p1.x - (next.x - p0.x) * tension;
    const cp2y = p1.y - (next.y - p0.y) * tension;
    d += ` C${cp1x.toFixed(1)} ${cp1y.toFixed(1)},${cp2x.toFixed(1)} ${cp2y.toFixed(1)},${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  return d;
}

function areaPath(
  pts: { x: number; y: number }[],
  pad: { top: number; right: number; bottom: number; left: number },
  innerH: number,
): string {
  if (!pts.length) return "";
  const base = pad.top + innerH;
  const line = smoothPath(pts);
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  return `${line} L${last.x.toFixed(1)} ${base} L${first.x.toFixed(1)} ${base} Z`;
}

function buildTicks(max: number): number[] {
  if (max <= 1) return [0, 1];
  const step = niceStep(max / 4);
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.01; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return ticks;
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  if (n <= 1) return pow;
  if (n <= 2) return 2 * pow;
  if (n <= 5) return 5 * pow;
  return 10 * pow;
}

function formatAxis(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return String(value);
}

function formatLabel(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const hasTime =
    timestamp.includes("T") &&
    !timestamp.endsWith("T00:00:00.000Z") &&
    !timestamp.endsWith("T00:00:00Z");
  return new Intl.DateTimeFormat("en", hasTime ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" }).format(date);
}
