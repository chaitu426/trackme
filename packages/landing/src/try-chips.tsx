"use client";

import * as React from "react";
import { runDemo, type DemoAction } from "./demo-bus";

const CHIPS: { label: string; action: DemoAction }[] = [
  { label: "Only Germany", action: { view: "overview", country: "Germany", device: null } },
  { label: "Last 30 days", action: { view: "overview", range: "30d" } },
  { label: "Mobile", action: { view: "overview", device: "Mobile" } },
  { label: "Funnels", action: { view: "funnels" } },
  { label: "Realtime", action: { view: "realtime" } },
];

/** One-tap ways into the demo, so nobody has to guess what it can do. */
export function TryChips() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4cc38a]" />
        Try
      </span>
      {CHIPS.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={() => runDemo(c.action)}
          className="inline-flex h-8 items-center rounded-lg border border-white/[0.1] bg-[#19191b]/80 px-3 text-[13px] text-zinc-300 transition-[color,border-color,transform] duration-150 hover:border-white/[0.24] hover:text-zinc-50 active:scale-[0.97]"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
