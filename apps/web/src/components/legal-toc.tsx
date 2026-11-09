"use client";

import * as React from "react";
import { LayoutGroup, motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface TocItem {
  id: string;
  title: string;
}

/** The sections of a long document, with the one being read marked. Clicking jumps to it; the mark slides between sections. */
export function LegalToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = React.useState(items[0]?.id ?? "");

  React.useEffect(() => {
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = items.find((i) => seen.get(i.id));
        if (first) setActive(first.id);
      },
      // A section counts as current while it is in the upper part of the viewport.
      { rootMargin: "-10% 0px -70% 0px" }
    );
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-3 font-mono text-xs text-zinc-500">On this page</p>
      <LayoutGroup id="legal-toc">
        <ul className="flex flex-col">
          {items.map((item) => (
            <li key={item.id} className="relative">
              {active === item.id && <motion.span layoutId="toc-mark" className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-zinc-200" transition={{ type: "spring", bounce: 0, visualDuration: 0.25 }} />}
              <a
                href={`#${item.id}`}
                aria-current={active === item.id ? "location" : undefined}
                className={cn("press block py-1.5 pl-4 transition-colors duration-150", active === item.id ? "text-zinc-50" : "text-zinc-500 hover:text-zinc-200")}
              >
                {item.title}
              </a>
            </li>
          ))}
        </ul>
      </LayoutGroup>
    </nav>
  );
}
