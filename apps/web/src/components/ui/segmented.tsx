import Link from "next/link";
import { cn } from "@/lib/utils";

export interface SegmentedItem {
  href: string;
  label: string;
  active: boolean;
}

/**
 * A row of mutually exclusive links (a currency, a view). It is made of links so the choice lives in the URL, can be shared
 * and works without client code. The active item is a surface step with a hairline, the same treatment as the range pills.
 */
export function Segmented({ items, label, className }: { items: SegmentedItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("inline-flex h-8 items-center gap-0.5 rounded-lg border border-border p-0.5 text-xs", className)}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "press inline-flex h-full items-center rounded-md px-3",
            item.active ? "bg-raised font-medium text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-zinc-400 hover:text-zinc-100"
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
