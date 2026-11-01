"use client";

import * as React from "react";
import { formatDuration, formatNumber, formatPercent } from "@/lib/format";

export type NumberFormat = "number" | "percent" | "decimal" | "duration";

const format = (value: number, kind: NumberFormat): string => {
  switch (kind) {
    case "percent":
      return formatPercent(value);
    case "decimal":
      return value > 0 ? value.toFixed(1) : "–";
    case "duration":
      return formatDuration(value);
    default:
      return formatNumber(value);
  }
};

// What each figure last showed. Changing the range remounts the cards behind their
// skeletons, so the previous value has to live outside the component.
const lastShown = new Map<string, number>();

const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

const DURATION_MS = 550;

/**
 * Shows a figure, and when it changes (a new range, a new filter) eases from the value it
 * showed before to the new one. The first appearance is never animated, and nothing moves
 * for people who ask for reduced motion.
 */
export function AnimatedNumber({ id, value, kind = "number" }: { id: string; value: number; kind?: NumberFormat }) {
  const [shown, setShown] = React.useState(value);

  useIsoLayoutEffect(() => {
    const from = lastShown.get(id);
    lastShown.set(id, value);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (from === undefined || from === value || reduce) {
      setShown(value);
      return;
    }
    setShown(from);
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [id, value]);

  return <span suppressHydrationWarning>{format(shown, kind)}</span>;
}
