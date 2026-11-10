"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

/** A code block with a copy button, for the one-line install tag. */
export function CopySnippet({ lines, text, label }: { lines: React.ReactNode; text: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be blocked; the text stays selectable.
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f10]">
      <div className="flex h-11 items-center justify-between border-b border-white/[0.08] pl-4 pr-2">
        <span className="font-mono text-xs text-zinc-500">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-50"
        >
          {copied ? <Check className="h-4 w-4 text-good" strokeWidth={1.5} /> : <Copy className="h-4 w-4" strokeWidth={1.5} />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-[22px] text-zinc-400">{lines}</pre>
    </div>
  );
}
