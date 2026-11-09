import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface RankedRow {
  key: string;
  label: ReactNode;
  /** 0 to 1: the bar's length. */
  share: number;
  value: ReactNode;
  /** A quiet caption under the name (a success rate, a count). */
  meta?: ReactNode;
  /** Draws the bar in the accent instead of the neutral step: the one row that matters. */
  emphasis?: boolean;
  /** Marks the row as a problem (red figure). */
  bad?: boolean;
  /** Makes the whole row a link (a filter), and `selected` shows which one is chosen. */
  href?: string;
  selected?: boolean;
}

/**
 * A ranked list with thin bars. Each row is a name with its caption underneath on the left and the main figure on the right,
 * so the figures stack in one right-aligned column of tabular digits at any card width, and a narrow card never squeezes a
 * name to nothing. The bar runs the full width under the row.
 */
export function RankedBars({ rows }: { rows: RankedRow[] }) {
  return (
    <ul>
      {rows.map((r, i) => {
        const body = (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm leading-5 text-zinc-200">{r.label}</p>
                {r.meta && <p className="truncate text-xs leading-4 text-zinc-500">{r.meta}</p>}
              </div>
              <p className={cn("shrink-0 text-right font-mono text-sm leading-5 tabular-nums", r.bad ? "text-[#e5484d]" : "text-zinc-50")}>{r.value}</p>
            </div>
            <div className="mt-2 h-1 rounded-full bg-white/[0.06]" aria-hidden="true">
              <div
                className={cn("grow-x h-1 rounded-full", r.emphasis ? "bg-zinc-100" : "bg-zinc-500")}
                style={{ width: `${Math.min(100, Math.max(r.share > 0 ? 1 : 0, r.share * 100))}%`, ["--i" as string]: i }}
              />
            </div>
          </>
        );
        return (
          <li key={r.key} className="border-t border-white/[0.04] first:border-t-0">
            {r.href ? (
              <Link href={r.href} scroll={false} aria-current={r.selected ? "true" : undefined} className={cn("press block px-5 py-3 transition-colors duration-150 hover:bg-white/[0.03]", r.selected && "bg-white/[0.05]")}>
                {body}
              </Link>
            ) : (
              <div className="px-5 py-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
