"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The loading mark of the product: the same glyph ramp as the pictures on the landing page and in page headers
 * (. : + #), travelling across a small grid as a wave. The glyph itself carries the weight, so it reads at any size and in any
 * colour (it takes the text colour of where it sits). With reduced motion on it holds one still frame.
 */
const RAMP = [".", ":", "+", "#"] as const;
const STEP_MS = 110;

function useFrame(active: boolean, stepMs = STEP_MS): number {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setFrame((f) => f + 1), stepMs);
    return () => window.clearInterval(timer);
  }, [active, stepMs]);
  return frame;
}

/** The glyph level (0 to 3) of one cell: a wave that moves along the diagonal, brightest at its head. */
export function glyphLevel(row: number, col: number, frame: number, period = 6): number {
  const phase = (((frame - (row + col)) % period) + period) % period;
  // Four steps of the ramp at the head, then dark until the wave comes round again.
  return phase < 4 ? phase : -1;
}

function Grid({ cols, rows, cell, font, className, label, stepMs }: { cols: number; rows: number; cell: number; font: number; className?: string | undefined; label: string; stepMs?: number | undefined }) {
  const frame = useFrame(true, stepMs);
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-grid shrink-0 select-none font-mono font-semibold", className)}
      style={{ gridTemplateColumns: `repeat(${cols}, ${cell}px)`, gridAutoRows: `${cell + 1}px`, fontSize: font, lineHeight: `${cell + 1}px` }}
    >
      {Array.from({ length: rows * cols }, (_, i) => {
        const level = glyphLevel(Math.floor(i / cols), i % cols, frame, cols + rows + 1);
        return (
          <span key={i} aria-hidden="true" className="text-center" style={{ opacity: level < 0 ? 0.18 : 0.35 + level * 0.22 }}>
            {RAMP[level < 0 ? 0 : level]}
          </span>
        );
      })}
    </span>
  );
}

/** A small inline mark for buttons and short waits (3 by 3 glyphs, about 15px). Takes the colour of its text. */
export function MatrixSpinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return <Grid cols={3} rows={3} cell={5} font={7} className={className} label={label} />;
}

/**
 * A larger mark for a block that is loading (a chart, a list, a whole panel), with an optional line of text under it.
 * Wide on purpose: the wave has room to travel, like the stream picture on the landing page.
 */
export function MatrixLoader({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 text-zinc-300", className)}>
      <Grid cols={14} rows={4} cell={9} font={11} label={label ?? "Loading"} />
      {label && <p className="text-xs text-zinc-500">{label}</p>}
    </div>
  );
}
