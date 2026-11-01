"use client";

import * as React from "react";
import { Check, Copy, Play, RotateCcw } from "lucide-react";

/**
 * A console for the one-line install. Copy the tag, then play the first event arriving, the
 * same moment the dashboard confirms in a real workspace. The log is a simulation.
 */

type Line = { at: number; tone: "muted" | "ok" | "text"; text: string };

const LOG: Line[] = [
  { at: 0, tone: "muted", text: "POST /v1/batch" },
  { at: 500, tone: "text", text: "202 accepted · 1 event · 38 ms" },
  { at: 1100, tone: "ok", text: "pageview  /  ·  Berlin  ·  Chrome on macOS" },
  { at: 1900, tone: "muted", text: "visitor pseudonym rotates in 24 h" },
  { at: 2500, tone: "ok", text: "First event received" },
];

export function InstallConsole({ snippet, lines, compact = false }: { snippet: string; lines: React.ReactNode; compact?: boolean }) {
  const [copied, setCopied] = React.useState(false);
  const [shown, setShown] = React.useState(0);
  const [running, setRunning] = React.useState(false);
  const timers = React.useRef<number[]>([]);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  React.useEffect(() => clear, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      timers.current.push(window.setTimeout(() => setCopied(false), 1800));
    } catch {
      // Clipboard access can be blocked; the text stays selectable.
    }
  };

  const play = () => {
    clear();
    setShown(0);
    setRunning(true);
    LOG.forEach((line, i) => {
      timers.current.push(
        window.setTimeout(() => {
          setShown(i + 1);
          if (i === LOG.length - 1) setRunning(false);
        }, line.at + 250),
      );
    });
  };

  const done = shown === LOG.length;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0f0f10] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.9)]">
      <div className="flex h-11 items-center justify-between border-b border-white/[0.08] pl-4 pr-2">
        <span className="flex items-center gap-2 font-mono text-xs text-zinc-500">
          <i className={`h-1.5 w-1.5 rounded-full ${done ? "bg-[#4cc38a]" : "animate-pulse bg-zinc-500"}`} />
          {done ? "first event received" : "waiting for the first event"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-50"
        >
          {copied ? <Check className="h-4 w-4 text-[#4cc38a]" strokeWidth={1.5} /> : <Copy className="h-4 w-4" strokeWidth={1.5} />}
          <span aria-live="polite">{copied ? "Copied" : "Copy tag"}</span>
        </button>
      </div>

      <pre className={`overflow-x-auto p-5 font-mono text-[13px] leading-[22px] text-zinc-400 ${compact ? "max-h-[168px]" : ""}`}>{lines}</pre>

      <div className="border-t border-white/[0.08] bg-[#141415] p-5">
        <div className="min-h-[112px] font-mono text-[13px] leading-[22px]" aria-live="polite">
          {shown === 0 && !running && <p className="text-zinc-600">Run the simulation to see the first event arrive.</p>}
          {LOG.slice(0, shown).map((line, i) => (
            <p
              key={i}
              className={line.tone === "ok" ? "text-[#4cc38a]" : line.tone === "text" ? "text-zinc-200" : "text-zinc-500"}
              style={{ animation: "stageIn 0.35s cubic-bezier(0.22,1,0.36,1) both" }}
            >
              {line.tone === "ok" ? "✓ " : "› "}
              {line.text}
            </p>
          ))}
          {running && <span className="inline-block h-4 w-2 animate-pulse bg-zinc-400 align-middle" />}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={play}
            disabled={running}
            className="inline-flex h-8 items-center gap-2 rounded-lg bg-[#ededed] px-3 text-xs font-medium text-[#141415] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-colors duration-150 hover:bg-white disabled:opacity-60"
          >
            {done ? <RotateCcw className="h-4 w-4" strokeWidth={1.5} /> : <Play className="h-4 w-4" strokeWidth={1.5} />}
            {done ? "Run again" : "Simulate first event"}
          </button>
        </div>
      </div>
    </div>
  );
}
