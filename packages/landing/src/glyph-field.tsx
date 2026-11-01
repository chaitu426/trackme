"use client";

import * as React from "react";

/**
 * The page's one picture language: a field of data glyphs (. : + #) whose weight follows a
 * shape. Each shape stands for something the product does, so the pattern always says
 * something about the section it sits in:
 *
 *   ridge   traffic over time (visitors line above the sessions line)
 *   steps   a funnel losing visitors at each step
 *   stream  events travelling from the site to the dashboard
 *   globe   where visitors are
 *   gauge   a Web Vitals score
 *   pulse   activity happening right now
 *   text    a word, set in glyphs
 *
 * A few cells step slowly so the field feels alive, and with `interactive` the glyphs near the
 * cursor light up. Nothing moves with reduced motion on.
 */

export type GlyphVariant = "ridge" | "steps" | "stream" | "globe" | "gauge" | "pulse" | "text";

/**
 * The visitors line of the traffic story, as a fraction of the picture's height (0 is the top).
 * It rises over time, has a spike where a post sent visitors, and a dip after it.
 * The hero pins its tags to this same curve.
 */
export function trafficLine(u: number): number {
  const spike = 0.13 * Math.exp(-(((u - 0.62) / 0.032) ** 2));
  const dip = 0.05 * Math.exp(-(((u - 0.75) / 0.04) ** 2));
  const v = 0.6 - 0.16 * u + 0.02 * Math.sin(u * 23) - spike + dip;
  return Math.min(0.9, Math.max(0.12, v));
}

const sessionsLine = (u: number) => trafficLine(u * 0.97 + 0.012) - 0.06;

type Shape = (u: number, v: number, x: number, y: number, w: number, h: number) => number;

const SHAPES: Record<Exclude<GlyphVariant, "text">, Shape> = {
  ridge: (u, v) => {
    const front = trafficLine(u);
    const back = sessionsLine(u);
    const l1 = v >= front ? Math.pow(Math.max(0, 1 - (v - front) / 0.5), 1.7) * 0.95 + (v - front < 0.014 ? 0.35 : 0) : 0;
    const l2 = v >= back ? Math.pow(Math.max(0, 1 - (v - back) / 0.34), 1.6) * 0.42 + (v - back < 0.012 ? 0.18 : 0) : 0;
    return Math.max(l1, l2);
  },

  steps: (u, v) => {
    const heights = [0.74, 0.46, 0.24, 0.15];
    const slot = (u - 0.1) / 0.2;
    const i = Math.floor(slot);
    if (i < 0 || i > 3 || slot - i > 0.82) return 0;
    const top = 0.88 - (heights[i] as number);
    if (v < top || v > 0.88) return 0;
    return 0.98 - ((v - top) / (heights[i] as number)) * 0.72;
  },

  stream: (u, v) => {
    let best = 0;
    for (let k = 0; k < 6; k++) {
      const y = 0.5 + 0.3 * Math.sin(u * 6.2 + k * 1.1) * (0.35 + 0.65 * (1 - u)) + (k - 2.5) * 0.045;
      best = Math.max(best, Math.exp(-(((v - y) / 0.028) ** 2)));
    }
    return best * (0.3 + 0.7 * u);
  },

  globe: (_u, _v, x, y, w, h) => {
    const R = Math.min(w, h) * 0.44;
    const nx = (x - w / 2) / R;
    const ny = (y - h / 2) / R;
    const d = Math.hypot(nx, ny);
    if (d > 1) return 0;
    const nz = Math.sqrt(1 - d * d);
    const light = Math.max(0, -0.35 * nx - 0.45 * ny + 0.82 * nz);
    const lon = Math.atan2(nx, nz);
    const lat = Math.asin(ny);
    const grid = Math.abs(Math.sin(lon * 5)) < 0.1 || Math.abs(Math.sin(lat * 7)) < 0.1 ? 0.55 : 1;
    return (0.16 + 0.84 * light) * grid + (d > 0.95 ? 0.35 : 0);
  },

  gauge: (_u, _v, x, y, w, h) => {
    const R = Math.min(w, h) * 0.4;
    const dx = x - w / 2;
    const dy = y - h / 2;
    const d = Math.hypot(dx, dy) / R;
    if (Math.abs(d - 1) > 0.11) return 0;
    let a = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (a < 150) a += 360;
    const t = (a - 150) / 240;
    if (t > 1) return 0;
    return t < 0.86 ? 0.35 + 0.65 * (t / 0.86) : 0.16;
  },

  pulse: (_u, _v, x, y, w, h) => {
    const d = Math.hypot(x - w / 2, y - h / 2) / (Math.min(w, h) * 0.5);
    let l = d < 0.05 ? 1 : 0;
    for (let k = 0; k < 4; k++) l = Math.max(l, Math.exp(-(((d - (0.22 + 0.22 * k)) / 0.025) ** 2)) * (1 - 0.2 * k));
    return l;
  },
};

const RAMP = [".", ":", "+", "#"];

type Cell = { x: number; y: number; level: number; color: string };

/** A word as a brightness mask on a cols x rows grid. */
function textMask(text: string, cols: number, rows: number): Uint8ClampedArray {
  const c = document.createElement("canvas");
  c.width = cols;
  c.height = rows;
  const t = c.getContext("2d", { willReadFrequently: true });
  if (!t) return new Uint8ClampedArray(cols * rows * 4);
  const family = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
  t.font = `800 100px ${family}`;
  const measured = t.measureText(text).width || 1;
  const size = Math.min(100 * ((cols * 0.96) / measured), rows * 1.02);
  t.font = `800 ${size}px ${family}`;
  t.textAlign = "center";
  t.textBaseline = "alphabetic";
  t.fillStyle = "#fff";
  t.fillText(text, cols / 2, rows * 0.9);
  return t.getImageData(0, 0, cols, rows).data;
}

export function GlyphField({
  variant,
  text,
  cell = 9,
  strength = 1,
  interactive = false,
  className = "absolute inset-0 h-full w-full",
}: {
  variant: GlyphVariant;
  /** The word to set when the variant is "text". */
  text?: string;
  cell?: number;
  /** Scales brightness, so the same shape can sit quietly behind content. */
  strength?: number;
  /** Glyphs near the cursor light up. */
  interactive?: boolean;
  className?: string;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cells: Cell[] = [];
    let lit: Cell[] = [];
    let raf = 0;
    let moveRaf = 0;
    let timer = 0;

    const paint = (c: Cell, level: number, color: string) => {
      ctx.clearRect(c.x - cell / 2, c.y - cell / 2, cell, cell);
      ctx.fillStyle = color;
      ctx.fillText(RAMP[level]!, c.x, c.y);
    };

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.font = `600 ${cell + 1}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const cols = Math.floor(w / cell);
      const rows = Math.floor(h / cell);
      const mask = variant === "text" ? textMask(text ?? "", cols, rows) : null;
      cells = [];
      lit = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const px = c * cell + cell / 2;
          const py = r * cell + cell / 2;
          let lum: number;
          if (mask) {
            lum = (mask[(r * cols + c) * 4 + 3]! / 255) * (1 - 0.5 * (r / rows));
          } else {
            lum = SHAPES[variant as Exclude<GlyphVariant, "text">]((c + 0.5) / cols, (r + 0.5) / rows, px, py, w, h);
          }
          lum = Math.min(1, lum * strength);
          if (lum < 0.08) continue;
          const level = lum > 0.78 ? 3 : lum > 0.46 ? 2 : lum > 0.22 ? 1 : 0;
          const tone = Math.round(78 + 177 * lum);
          cells.push({ x: px, y: py, level, color: `rgb(${tone},${tone},${tone})` });
        }
      }
      for (const cl of cells) {
        ctx.fillStyle = cl.color;
        ctx.fillText(RAMP[cl.level]!, cl.x, cl.y);
      }
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    document.fonts?.ready.then(schedule).catch(() => undefined);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) {
      timer = window.setInterval(() => {
        if (document.visibilityState !== "visible" || cells.length === 0) return;
        for (let n = 0; n < 32; n++) {
          const cl = cells[(Math.random() * cells.length) | 0]!;
          if (lit.includes(cl)) continue;
          const next = Math.max(0, Math.min(3, cl.level + (Math.random() < 0.5 ? -1 : 1)));
          paint(cl, next, cl.color);
          cl.level = next;
        }
      }, 160);
    }

    // Glyphs near the cursor step up to full brightness.
    let onMove: ((e: PointerEvent) => void) | undefined;
    if (interactive && !reduced) {
      const radius = 96;
      onMove = (e: PointerEvent) => {
        cancelAnimationFrame(moveRaf);
        moveRaf = requestAnimationFrame(() => {
          for (const cl of lit) paint(cl, cl.level, cl.color);
          lit = [];
          const rect = canvas.getBoundingClientRect();
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          if (px < -radius || py < -radius || px > rect.width + radius || py > rect.height + radius) return;
          for (const cl of cells) {
            if (Math.abs(cl.x - px) > radius || Math.abs(cl.y - py) > radius) continue;
            const d = Math.hypot(cl.x - px, cl.y - py);
            if (d > radius) continue;
            lit.push(cl);
            paint(cl, d < radius * 0.55 ? 3 : 2, "rgb(255,255,255)");
          }
        });
      };
      window.addEventListener("pointermove", onMove, { passive: true });
    }

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(moveRaf);
      window.clearInterval(timer);
      if (onMove) window.removeEventListener("pointermove", onMove);
      observer.disconnect();
    };
  }, [variant, text, cell, strength, interactive]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
