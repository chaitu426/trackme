"use client";

import * as React from "react";
import Link from "next/link";
import { LayoutGroup, motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface SegmentedItem {
  href: string;
  label: string;
  active: boolean;
}

/**
 * A row of mutually exclusive links (a currency, a view). The choice lives in the URL, so it can be shared and survives a reload;
 * the highlight slides to the clicked item right away and the page catches up behind it.
 */
export function Segmented({ items, label, className }: { items: SegmentedItem[]; label: string; className?: string }) {
  const group = React.useId();
  const current = items.find((i) => i.active)?.href;
  const [optimistic, setOptimistic] = React.useState<string | null>(null);
  React.useEffect(() => setOptimistic(null), [current]);
  const active = optimistic ?? current;

  return (
    <LayoutGroup id={group}>
      <nav aria-label={label} className={cn("inline-flex h-8 items-center gap-0.5 rounded-lg border border-border p-0.5 text-xs", className)}>
        {items.map((item) => {
          const on = item.href === active;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOptimistic(item.href)}
              aria-current={on ? "page" : undefined}
              className={cn("press relative inline-flex h-full items-center rounded-md px-3", on ? "font-medium text-zinc-50" : "text-zinc-400 hover:text-zinc-100")}
            >
              {on && <motion.span layoutId="segment-pill" className="absolute inset-0 rounded-md bg-raised shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" transition={{ type: "spring", bounce: 0, visualDuration: 0.25 }} />}
              <span className="relative">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}
