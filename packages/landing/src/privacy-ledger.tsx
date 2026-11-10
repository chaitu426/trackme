"use client";

import * as React from "react";
import { ArrowRight, Check, RotateCcw } from "lucide-react";
import { useInView } from "./motion";

/**
 * What a typical tool keeps, and what TrackMe keeps instead. The left column dissolves into
 * data glyphs as the section comes into view, to show it is not kept. Hover a row to see what
 * the value was.
 */

const ROWS: { label: string; typical: string; ours: string; note: string }[] = [
  { label: "IP address", typical: "203.0.113.42", ours: "DE", note: "The country, then the address is gone" },
  { label: "Visitor identity", typical: "_ga=GA1.2.1946582013.1727", ours: "A daily pseudonym", note: "Rotates every 24 hours" },
  { label: "Page URL", typical: "/pricing?email=ana@acme.com&t=9f2c", ours: "/pricing", note: "Query stripped, campaign tags kept" },
  { label: "Do Not Track", typical: "ignored", ours: "Respected", note: "By default, and consent can gate collection" },
  { label: "Where it runs", typical: "the vendor’s cloud", ours: "Your infrastructure", note: "ClickHouse and Kafka" },
];

const GLYPHS = [".", ":", "+", "#"];

/** Characters turn into glyphs from the left, one after another. */
function Dissolve({ text, run, delay }: { text: string; run: number; delay: number }) {
  const [shown, setShown] = React.useState(text);

  React.useEffect(() => {
    if (run === 0) {
      setShown(text);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(text.replace(/\S/g, "#"));
      return;
    }
    let raf = 0;
    const start = performance.now() + delay;
    const duration = 900;
    const tick = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / duration));
      const cut = Math.floor(t * text.length);
      setShown(
        text
          .split("")
          .map((ch, i) => (ch === " " ? " " : i < cut ? "#" : i < cut + 3 && t < 1 ? GLYPHS[Math.floor(Math.random() * 4)]! : ch))
          .join(""),
      );
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, text, delay]);

  return <>{shown}</>;
}

export function PrivacyLedger() {
  const [ref, seen] = useInView<HTMLDivElement>({ threshold: 0.35 });
  const [run, setRun] = React.useState(0);

  React.useEffect(() => {
    if (seen) setRun((n) => n || 1);
  }, [seen]);

  return (
    <div ref={ref} className="overflow-hidden rounded-2xl border border-white/[0.1] bg-[#19191b]">
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#0f0f10] px-5 py-3 sm:px-7">
        <div className="hidden grid-cols-[200px_1fr_32px_1fr] items-center gap-6 text-xs text-zinc-500 md:grid md:flex-1">
          <span>Data</span>
          <span>A typical tool keeps</span>
          <span />
          <span>TrackMe keeps</span>
        </div>
        <span className="text-xs text-zinc-500 md:hidden">Typical tool → TrackMe</span>
        <button
          type="button"
          onClick={() => setRun((n) => n + 1)}
          className="inline-flex h-7 items-center gap-2 rounded-md px-2 font-mono text-xs text-zinc-500 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-200"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
          Replay
        </button>
      </div>

      <ul>
        {ROWS.map((row, i) => (
          <li key={row.label} className="group grid gap-3 border-b border-white/[0.07] px-5 py-5 transition-colors duration-150 last:border-0 hover:bg-white/[0.02] sm:px-7 md:grid-cols-[200px_1fr_32px_1fr] md:items-center md:gap-6">
            <span className="text-sm font-medium text-zinc-100">{row.label}</span>

            <span className="relative block min-h-[24px] font-mono text-[13px] leading-6 text-zinc-500">
              <span className="block break-all transition-opacity duration-200 group-hover:opacity-0">
                <Dissolve text={row.typical} run={run} delay={i * 220} />
              </span>
              <span className="absolute inset-0 block break-all text-zinc-300 opacity-0 transition-opacity duration-200 group-hover:opacity-100">{row.typical}</span>
            </span>

            <ArrowRight className="hidden h-4 w-4 text-zinc-600 md:block" strokeWidth={1.5} />

            <span className="flex items-start gap-3">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-good/40 text-good">
                <Check className="h-3 w-3" strokeWidth={2} />
              </span>
              <span>
                <span className="block text-sm font-medium text-zinc-50">{row.ours}</span>
                <span className="mt-0.5 block text-[13px] leading-5 text-zinc-500">{row.note}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
