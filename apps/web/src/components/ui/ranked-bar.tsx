import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface RankedRow {
  key: string;
  label: ReactNode;
  /** 0 to 1: the bar's length. */
  share: number;
  value: ReactNode;
  /** A quiet second figure under or beside the value. */
  meta?: ReactNode;
  /** Draws the bar in the accent instead of the neutral step: the one row that matters. */
  emphasis?: boolean;
  /** Marks the row as a problem (red figure). */
  bad?: boolean;
}

/** A ranked list with thin bars: the quiet way to show a share or a comparison next to a main chart. */
export function RankedBars({ rows }: { rows: RankedRow[] }) {
  return (
    <ul>
      {rows.map((r, i) => (
        <li key={r.key} className="border-t border-white/[0.04] px-5 py-3 first:border-t-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm text-zinc-200">{r.label}</span>
            <span className={cn("shrink-0 font-mono text-sm tabular-nums", r.bad ? "text-[#e5484d]" : "text-zinc-50")}>
              {r.value}
              {r.meta && <span className="ml-2 text-xs text-zinc-500">{r.meta}</span>}
            </span>
          </div>
          <div className="mt-2 h-1 rounded-full bg-white/[0.06]" aria-hidden="true">
            <div
              className={cn("grow-x h-1 rounded-full", r.emphasis ? "bg-zinc-100" : "bg-zinc-500")}
              style={{ width: `${Math.min(100, Math.max(r.share > 0 ? 1 : 0, r.share * 100))}%`, ["--i" as string]: i }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
