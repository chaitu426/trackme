"use client";

import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import { GlyphField, trafficLine } from "./glyph-field";
import { openDemoView, type DemoViewId } from "./demo-bus";

/**
 * The hero picture is the product's own subject, traffic, drawn as data glyphs. The line tells
 * one story: traffic grows, a post sends a spike of visitors, the weekend dips. Each tag marks
 * a real moment on that line and names the part of the product that explains it. Selecting a
 * tag opens that view in the live demo below.
 */

const TAGS: { label: string; value: string; view: DemoViewId; u: number; dx: number; lift: number; delay: number }[] = [
  { label: "Realtime", value: "38 online now", view: "realtime", u: 0.56, dx: 0.0, lift: -0.11, delay: 0.5 },
  { label: "Acquisition", value: "Hacker News · +1,840 visits", view: "acquisition", u: 0.62, dx: 0.0, lift: 0.22, delay: 0.65 },
  { label: "Funnels", value: "39% reach pricing", view: "funnels", u: 0.745, dx: 0.025, lift: 0.14, delay: 0.8 },
  { label: "Audience", value: "Berlin · 12% of visitors", view: "geography", u: 0.85, dx: -0.02, lift: 0.27, delay: 0.95 },
  { label: "Web Vitals", value: "LCP 1.8 s · Good", view: "vitals", u: 0.94, dx: -0.05, lift: 0.13, delay: 1.1 },
];

export function HeroScene() {
  return (
    <div className="relative h-[340px] overflow-hidden md:absolute md:inset-x-0 md:top-0 md:h-[720px]">
      <GlyphField variant="ridge" />

      {/* Leader lines, in the picture's own coordinates */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 hidden h-full w-full md:block" aria-hidden="true">
        {TAGS.map((t) => (
          <line
            key={t.label}
            x1={(t.u + t.dx) * 100}
            y1={(trafficLine(t.u) - t.lift) * 100}
            x2={t.u * 100}
            y2={trafficLine(t.u) * 100}
            stroke="rgba(237,237,237,0.5)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            className="hero-tag"
            style={{ animationDelay: `${t.delay}s` }}
          />
        ))}
      </svg>

      <div className="absolute inset-0 hidden md:block">
        {TAGS.map((t) => (
          <React.Fragment key={t.label}>
            <i
              aria-hidden="true"
              className="hero-tag pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 border border-[#141415] bg-[#ededed]"
              style={{ left: `${t.u * 100}%`, top: `${trafficLine(t.u) * 100}%`, animationDelay: `${t.delay}s` }}
            />
            <button
              type="button"
              onClick={() => openDemoView(t.view)}
              className="hero-tag group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-start gap-0.5 whitespace-nowrap rounded-lg bg-[#ededed] px-3 py-2 text-left shadow-[0_10px_24px_-10px_rgba(0,0,0,0.8)] transition-colors duration-150 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-100"
              style={{ left: `${(t.u + t.dx) * 100}%`, top: `${(trafficLine(t.u) - t.lift) * 100}%`, animationDelay: `${t.delay}s` }}
              aria-label={`${t.label}: ${t.value}. Open in the demo`}
            >
              <span className="flex items-center gap-1 text-[11px] leading-4 text-[#5b5b61]">
                {t.label}
                <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100" strokeWidth={1.75} />
              </span>
              <span className="font-mono text-[12px] leading-4 text-[#141415]">{t.value}</span>
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Small screens: the same tags as a row of buttons */}
      <div className="absolute inset-x-3 bottom-3 flex gap-2 overflow-x-auto md:hidden">
        {TAGS.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => openDemoView(t.view)}
            className="shrink-0 rounded-lg bg-[#ededed] px-3 py-2 text-left"
          >
            <span className="block text-[11px] leading-4 text-[#5b5b61]">{t.label}</span>
            <span className="block font-mono text-[12px] leading-4 text-[#141415]">{t.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
