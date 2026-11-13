"use client";

import * as React from "react";
import { glyphBar } from "@/lib/glyph-bar";
import { cn } from "@/lib/utils";

const TONE = {
  ok: "text-zinc-100",
  warn: "text-warning",
  full: "text-bad",
  unlimited: "text-zinc-500",
} as const;

/**
 * A usage meter drawn in the product's own glyphs: a run of `#` that fades out through `+` and `:` over a field of dots,
 * the same ramp as the landing page and the page headers. Turns amber at 80% and red at the limit. The bar is decoration;
 * the label and the numbers carry the meaning, and the element is a proper `meter` for assistive technology.
 */
export function GlyphMeter({
  label,
  value,
  limit,
  unit,
  cells = 28,
  className,
}: {
  label: string;
  value: number;
  /** null means the plan has no limit. */
  limit: number | null;
  unit?: string;
  cells?: number;
  className?: string;
}) {
  const bar = glyphBar(value, limit, cells);
  // The fill sweeps in once on mount; with reduced motion it simply appears.
  const [drawn, setDrawn] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const figures =
    limit === null ? `${value.toLocaleString("en-US")} · Unlimited` : `${value.toLocaleString("en-US")} / ${limit.toLocaleString("en-US")}${unit ? ` ${unit}` : ""}`;
  const status = bar.state === "full" ? "At the limit" : bar.state === "warn" ? "Near the limit" : null;

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuenow={value}
      {...(limit !== null ? { "aria-valuemax": limit } : {})}
      aria-valuetext={`${figures}${status ? `, ${status.toLowerCase()}` : ""}`}
      className={cn("min-w-0", className)}
    >
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="truncate text-zinc-300">{label}</span>
        <span className={cn("shrink-0 font-mono tabular-nums", bar.state === "warn" ? "text-warning" : bar.state === "full" ? "text-bad" : "text-zinc-400")}>{figures}</span>
      </div>
      <div aria-hidden="true" className="relative mt-1.5 select-none overflow-hidden whitespace-pre font-mono text-[13px] leading-none tracking-[0.2em]">
        <span className={bar.state === "unlimited" ? "text-white/[0.22]" : "text-white/[0.12]"}>{(bar.state === "unlimited" ? ":" : ".").repeat(cells)}</span>
        {bar.filled && (
          <span
            className={cn("absolute inset-0 transition-[clip-path] duration-700 ease-out motion-reduce:transition-none", TONE[bar.state])}
            style={{ clipPath: drawn ? "inset(0 0 0 0)" : "inset(0 100% 0 0)" }}
          >
            {bar.filled}
          </span>
        )}
      </div>
    </div>
  );
}
