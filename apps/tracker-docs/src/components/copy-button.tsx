"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Copies the code currently shown in the surrounding code block. It reads the
 * text from the page at click time, so snippets already personalised with the
 * reader's own site key copy with those values.
 */
export function CopyButton({ className }: { className?: string }) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy(event: React.MouseEvent<HTMLButtonElement>) {
    const root = event.currentTarget.closest("[data-code-root]");
    const pre =
      root?.querySelector("[data-code-panel]:not([hidden]) pre") ?? root?.querySelector("pre");
    const text = pre?.textContent ?? "";
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy code"}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100 active:scale-95",
        className
      )}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-emerald-400">Copied</span>
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Copy</span>
        </>
      )}
    </button>
  );
}
