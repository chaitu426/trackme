"use client";

import { useState } from "react";
import type { TimeSeriesPoint } from "@trackme/analytics";

type SeriesKey = "visitors" | "sessions" | "pageviews";

const SERIES_COLORS: Record<SeriesKey, string> = {
  visitors: "#3b82f6", // vibrant blue
  sessions: "#a855f7", // purple
  pageviews: "#22c55e", // emerald
};

export function TimeSeriesChart({
  points,
  primary = "visitors",
  secondary = "sessions",
}: {
  points: TimeSeriesPoint[];
  primary?: SeriesKey;
  secondary?: SeriesKey | null;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!points.length) {
    return (
      <div className="flex h-[260px] flex-col items-center justify-center rounded-lg border border-dashed border-white/10 text-xs text-zinc-500">
        <p>A traffic chart will appear as tracked pageviews arrive.</p>
      </div>
    );
  }

  const width = 800;
  const height = 260;
  const pad = { top: 20, right: 24, bottom: 36, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const primaryValues = points.map((p) => p[primary]);
  const secondaryValues = secondary ? points.map((p) => p[secondary]) : [];
  const max = Math.max(...primaryValues, ...secondaryValues, 1);
  const yTicks = buildTicks(max);

  const primaryColor = SERIES_COLORS[primary];
  const secondaryColor = secondary ? SERIES_COLORS[secondary] : "var(--chart-muted)";

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
  const secondaryAreaPath = secondaryPts.length ? areaPath(secondaryPts, pad, innerH) : "";

  const labelStep = Math.max(1, Math.ceil(points.length / 7));
  const primaryId = `grad-primary-${primary}`;
  const secondaryId = `grad-secondary-${secondary ?? "none"}`;

  const hoveredPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const hoveredPrimaryPt = hoverIndex !== null ? primaryPts[hoverIndex] : null;

  return (
    <div className="relative w-full overflow-hidden select-none">
      {/* Top Legend Bar & Hover Live Indicator */}
      <div className="flex items-center justify-between px-5 pb-2 text-xs">
        <div className="flex items-center gap-4">
          <LegendDot color={primaryColor} label={capitalize(primary)} />
          {secondary && <LegendDot color={secondaryColor} label={capitalize(secondary)} />}
        </div>
        {hoveredPoint ? (
          <div className="flex items-center gap-3 font-mono text-[11px] text-zinc-300">
            <span className="text-zinc-500">{formatLabel(hoveredPoint.timestamp)}:</span>
            <span className="flex items-center gap-1 font-semibold text-blue-400">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
              {hoveredPoint[primary].toLocaleString()}
            </span>
            {secondary && (
              <span className="flex items-center gap-1 font-semibold text-purple-400">
                <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
                {hoveredPoint[secondary].toLocaleString()}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-zinc-600 font-sans">Hover points to inspect</span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[250px] w-full overflow-visible"
        role="img"
        aria-label="Traffic over time"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={primaryId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryColor} stopOpacity="0.22" />
            <stop offset="85%" stopColor={primaryColor} stopOpacity="0.01" />
          </linearGradient>
          {secondary && (
            <linearGradient id={secondaryId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={secondaryColor} stopOpacity="0.14" />
              <stop offset="85%" stopColor={secondaryColor} stopOpacity="0.01" />
            </linearGradient>
          )}
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
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="3 4"
              />
              <text
                x={pad.left - 10}
                y={y + 3.5}
                textAnchor="end"
                className="fill-zinc-500 font-mono"
                style={{ fontSize: 10 }}
              >
                {formatAxis(tick)}
              </text>
            </g>
          );
        })}

        {/* Area gradients */}
        {secondaryAreaPath && <path d={secondaryAreaPath} fill={`url(#${secondaryId})`} />}
        <path d={primaryAreaPath} fill={`url(#${primaryId})`} />

        {/* Secondary curve line */}
        {secondaryPath && (
          <path
            d={secondaryPath}
            fill="none"
            stroke={secondaryColor}
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.8}
          />
        )}

        {/* Primary curve line */}
        <path
          d={primaryPath}
          fill="none"
          stroke={primaryColor}
          strokeWidth={2.25}
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
            stroke="rgba(255,255,255,0.2)"
            strokeDasharray="2 3"
            strokeWidth={1.5}
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

              {/* Glowing active point markers */}
              {isHovered && (
                <>
                  {secondaryPts[index] && (
                    <circle
                      cx={secondaryPts[index]!.x}
                      cy={secondaryPts[index]!.y}
                      r={4.5}
                      fill="#0c0c0e"
                      stroke={secondaryColor}
                      strokeWidth={2}
                    />
                  )}
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={5}
                    fill="#0c0c0e"
                    stroke={primaryColor}
                    strokeWidth={2.5}
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
              style={{ fontSize: 10 }}
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
          stroke="rgba(255,255,255,0.08)"
        />
      </svg>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]" style={{ background: color }} />
      <span className="text-[11px] font-medium text-zinc-400">{label}</span>
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
