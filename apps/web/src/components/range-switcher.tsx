"use client";

import * as React from "react";
import Link from "next/link";
import { LayoutGroup, motion } from "motion/react";
import { RANGE_OPTIONS, type RangeKey } from "@/lib/date-range";

/**
 * Range pills for report pages. The highlight slides to the clicked pill at once instead of waiting for the server round trip;
 * `extraQuery` carries filters such as `&country=US`.
 */
export function RangeSwitcher({ range, extraQuery = "" }: { range: RangeKey; extraQuery?: string }) {
  const [optimistic, setOptimistic] = React.useState<RangeKey | null>(null);
  React.useEffect(() => setOptimistic(null), [range]);
  const active = optimistic ?? range;
  const group = React.useId();

  return (
    <LayoutGroup id={group}>
      <div className="flex h-8 items-center gap-0.5 rounded-lg border border-border p-0.5 text-xs">
        {RANGE_OPTIONS.map((option) => (
          <Link
            key={option.key}
            href={`?range=${option.key}${extraQuery}`}
            onClick={() => setOptimistic(option.key)}
            aria-current={option.key === active ? "true" : undefined}
            className={`press relative inline-flex h-full items-center rounded-md px-3 ${option.key === active ? "font-medium text-zinc-50" : "text-zinc-400 hover:text-zinc-100"}`}
          >
            {option.key === active && (
              <motion.span layoutId="range-pill" className="absolute inset-0 rounded-md bg-raised shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" transition={{ type: "spring", bounce: 0, visualDuration: 0.25 }} />
            )}
            <span className="relative">{option.label}</span>
          </Link>
        ))}
      </div>
    </LayoutGroup>
  );
}
