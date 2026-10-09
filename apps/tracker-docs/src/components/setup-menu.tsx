"use client";

import * as React from "react";
import { SlidersHorizontal, RotateCcw } from "lucide-react";
import { PLACEHOLDERS, type PlaceholderKey } from "@/lib/site";
import { readSetup, writeSetup, type Setup } from "@/components/token-sync";
import { cn } from "@/lib/utils";

const FIELDS: { key: PlaceholderKey; label: string; hint: string; mono?: boolean }[] = [
  { key: "siteKey", label: "Site key", hint: "Dashboard → Site & Snippet. Starts with site_pub_." },
  { key: "scriptUrl", label: "Tracker script URL", hint: "Where your dashboard serves /tracker.js." },
  { key: "ingestUrl", label: "Ingest endpoint", hint: "Your collector URL, ending in /v1/batch." },
];

/** "Your setup": values typed here replace the placeholders in every code sample. */
export function SetupMenu() {
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<Setup>({});
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setValues(readSetup());
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const customised = Object.values(values).some((value) => value && value.trim().length > 0);

  function update(key: PlaceholderKey, value: string) {
    const next = { ...values, [key]: value };
    setValues(next);
    writeSetup(next);
  }

  function reset() {
    setValues({});
    writeSetup({});
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition",
          open || customised
            ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
            : "border-white/10 text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Your setup</span>
        {customised && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Your setup"
          className="animate-slide-down absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-white/10 bg-zinc-950 p-4 shadow-float"
        >
          <p className="text-[13px] font-semibold text-zinc-100">Use your own values</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            Fill these in and every code sample on this site updates, ready to copy. Values stay in this browser and are
            never sent anywhere.
          </p>

          <div className="mt-4 space-y-3">
            {FIELDS.map((field) => (
              <label key={field.key} className="block">
                <span className="text-[11px] font-medium text-zinc-300">{field.label}</span>
                <input
                  type="text"
                  value={values[field.key] ?? ""}
                  onChange={(event) => update(field.key, event.target.value)}
                  placeholder={PLACEHOLDERS[field.key]}
                  spellCheck={false}
                  autoComplete="off"
                  className="mt-1 h-8 w-full rounded-md border border-white/10 bg-white/[0.03] px-2.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none"
                />
                <span className="mt-1 block text-[10.5px] text-zinc-600">{field.hint}</span>
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={reset}
            disabled={!customised}
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-zinc-500 transition hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to placeholders
          </button>
        </div>
      )}
    </div>
  );
}
