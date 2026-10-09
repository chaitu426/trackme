"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * "On this page". Built from the headings in the rendered article, so it never
 * drifts from the content, and highlights the section being read.
 */
export function OnThisPage() {
  const pathname = usePathname();
  const [headings, setHeadings] = React.useState<Heading[]>([]);
  const [active, setActive] = React.useState<string>("");

  React.useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("article.doc h2[id], article.doc h3[id]"));
    setHeadings(
      nodes.map((node) => ({
        id: node.id,
        text: (node.firstChild?.textContent ?? node.textContent ?? "").trim(),
        level: node.tagName === "H2" ? 2 : 3,
      }))
    );
    setActive(nodes[0]?.id ?? "");

    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-72px 0px -70% 0px", threshold: 0 }
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [pathname]);

  if (headings.length < 2) return null;

  return (
    <nav aria-label="On this page" className="text-[12.5px]">
      <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-600">On this page</p>
      <ul className="space-y-0.5 border-l border-white/[0.06]">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={cn(
                "no-underline-link -ml-px block border-l py-1 leading-snug transition",
                heading.level === 3 ? "pl-6" : "pl-3",
                active === heading.id
                  ? "border-blue-400 text-zinc-50"
                  : "border-transparent text-zinc-500 hover:border-white/20 hover:text-zinc-200"
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
