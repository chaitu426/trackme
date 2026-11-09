import { cn } from "@/lib/utils";

const TONES = { ok: "bg-[#4cc38a]", warn: "bg-amber-400", bad: "bg-[#e5484d]", idle: "bg-zinc-600" } as const;

/** A small status mark with its word. Only `live` pulses, and only because the thing it marks is happening now. */
export function StatusDot({ tone, label, live = false, className }: { tone: keyof typeof TONES; label: string; live?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs text-zinc-300", className)}>
      <span className={cn("size-1.5 rounded-full", TONES[tone], live && "pulse-live")} aria-hidden="true" />
      {label}
    </span>
  );
}
