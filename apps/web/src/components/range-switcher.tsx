"use client";

import * as React from "react";
import Link from "next/link";
import { RANGE_OPTIONS, type RangeKey } from "@/lib/date-range";

/**
 * Range pills for report pages. The clicked pill lights up immediately instead of
 * waiting for the server round trip; `extraQuery` carries filters such as `&country=US`.
 */
export function RangeSwitcher({ range, extraQuery = "" }: { range: RangeKey; extraQuery?: string }) {
  const [optimistic, setOptimistic] = React.useState<RangeKey | null>(null);
  React.useEffect(() => setOptimistic(null), [range]);
  const active = optimistic ?? range;

  return (
    <div className="flex h-8 items-center gap-0.5 rounded-lg border border-border p-0.5 text-xs text-zinc-400">
      {RANGE_OPTIONS.map((option) => (
        <Link
          key={option.key}
          href={`?range=${option.key}${extraQuery}`}
          onClick={() => setOptimistic(option.key)}
          className={`inline-flex h-full items-center rounded-md px-3 transition-colors ${
            option.key === active
              ? "bg-raised font-medium text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
              : "text-zinc-400 hover:text-zinc-100"
          }`}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}
