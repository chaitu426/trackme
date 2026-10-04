import Link from "next/link";
import type { ReactNode } from "react";

export type RankingItem = {
  name: string;
  value: number;
  percentage: number;
  href?: string;
  meta?: string;
  icon?: ReactNode;
};

export function RankingList({
  items,
  empty = "No data yet.",
  valueFormatter = (value: number) => value.toLocaleString(),
  showBar = true,
}: {
  items: RankingItem[];
  empty?: string;
  valueFormatter?: (value: number) => string;
  showBar?: boolean;
}) {
  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2">
        <div className="w-8 h-8 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
          <span className="text-zinc-600 text-xs">–</span>
        </div>
        <p className="text-xs text-zinc-500">{empty}</p>
      </div>
    );
  }

  const maxValue = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="space-y-0.5">
      {items.map((item, rank) => {
        const widthPct = Math.max((item.value / maxValue) * 100, 1.5);

        const content = (
          <>
            {/* Percentage bar — full row background */}
            {showBar && (
              <div
                className="pointer-events-none absolute inset-y-0 left-0 rounded-[5px] transition-all duration-500"
                style={{
                  width: `${widthPct}%`,
                  background: "linear-gradient(90deg, rgba(59,130,246,0.10) 0%, rgba(59,130,246,0.04) 100%)",
                }}
              />
            )}

            {/* Row content */}
            <div className="relative z-10 flex items-center gap-3 w-full">
              {/* Rank number */}
              <span className="shrink-0 w-4 text-right font-mono text-[10px] text-zinc-600 tabular-nums">
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
                  <p className="truncate text-[11px] text-zinc-500 mt-0.5">{item.meta}</p>
                )}
              </div>

              {/* Value */}
              <div className="shrink-0 flex items-center gap-2 text-right">
                <span className="font-mono text-[12px] tabular-nums text-zinc-300 font-medium">
                  {valueFormatter(item.value)}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-zinc-600 w-8 text-right">
                  {item.percentage.toFixed(0)}%
                </span>
              </div>
            </div>
          </>
        );

        const rowCls =
          "relative flex items-center overflow-hidden rounded-[6px] px-2.5 py-2 transition-colors hover:bg-white/[0.04] cursor-default";

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
    </div>
  );
}
