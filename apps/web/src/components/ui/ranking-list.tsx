import Link from "next/link";
import type { ReactNode } from "react";
import { Paginated } from "@/components/ui/paginated";
import { MatrixArt } from "@/components/ui/matrix-art";

export type RankingItem = {
  name: string;
  value: number;
  percentage: number;
  href?: string;
  /** Makes the row a button. Only usable where the list renders in a client component. */
  onClick?: () => void;
  /** Draws the row as the current selection. */
  active?: boolean;
  meta?: string;
  icon?: ReactNode;
};

export function RankingList({
  items,
  empty = "No data yet.",
  valueFormatter = (value: number) => value.toLocaleString(),
  showBar = true,
  pageSize = 10,
}: {
  items: RankingItem[];
  empty?: string;
  valueFormatter?: (value: number) => string;
  showBar?: boolean;
  /** Rows per page; the pager only appears when there are more rows than this. */
  pageSize?: number;
}) {
  if (!items.length) {
    return (
      <MatrixArt variant="pulse" className="h-full min-h-[10rem] flex-1" strength={0.7}>
        <p className="text-xs text-zinc-400">{empty}</p>
      </MatrixArt>
    );
  }

  const maxValue = Math.max(...items.map((i) => i.value), 1);

  return (
    <Paginated pageSize={pageSize} className="space-y-0.5">
      {items.map((item, rank) => {
        const widthPct = Math.max((item.value / maxValue) * 100, 1.5);

        const content = (
          <>
            {/* Percentage bar — full row background */}
            {showBar && (
              <div
                className="pointer-events-none absolute inset-y-0 left-0 rounded-md"
                style={{
                  width: `${widthPct}%`,
                  background: "linear-gradient(90deg, rgba(237,237,237,0.10) 0%, rgba(237,237,237,0.04) 100%)",
                }}
              />
            )}

            {/* Row content */}
            <div className="relative z-10 flex items-center gap-3 w-full">
              {/* Rank number */}
              <span className="shrink-0 w-4 text-right font-mono text-xs text-zinc-600 tabular-nums">
                {rank + 1}
              </span>

              {/* Icon */}
              {item.icon && (
                <span className="shrink-0 text-zinc-500">{item.icon}</span>
              )}

              {/* Name + meta */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-zinc-200 leading-tight">
                  {item.name}
                </p>
                {item.meta && (
                  <p className="truncate text-xs text-zinc-500 mt-0.5">{item.meta}</p>
                )}
              </div>

              {/* Value */}
              <div className="shrink-0 flex items-center gap-2 text-right">
                <span className="font-mono text-xs tabular-nums text-zinc-300 font-medium">
                  {valueFormatter(item.value)}
                </span>
                <span className="font-mono text-xs tabular-nums text-zinc-600 w-8 text-right">
                  {item.percentage.toFixed(0)}%
                </span>
              </div>
            </div>
          </>
        );

        const rowCls =
          "relative flex items-center overflow-hidden rounded-[6px] px-3 py-2 transition-colors hover:bg-white/[0.04] cursor-default";

        if (item.onClick) {
          return (
            <button
              key={item.name}
              type="button"
              onClick={item.onClick}
              aria-pressed={item.active ?? false}
              className={`${rowCls} w-full cursor-pointer text-left ${item.active ? "bg-white/[0.07] ring-1 ring-white/[0.2]" : ""}`}
            >
              {content}
            </button>
          );
        }

        if (item.href) {
          return (
            <Link key={item.name} href={item.href} className={`${rowCls} cursor-pointer`}>
              {content}
            </Link>
          );
        }

        return (
          <div key={item.name} className={rowCls}>
            {content}
          </div>
        );
      })}
    </Paginated>
  );
}
