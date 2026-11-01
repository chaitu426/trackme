import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { GlyphField } from "@trackme/landing";
import { DASHBOARD_URL, PRODUCT } from "@/lib/site";

/** The same closing as the landing page: the name in glyphs, lit by the cursor. */
export function DocsFooter() {
  const links: [string, string][] = [
    ["Introduction", "/docs"],
    ["Quickstart", "/docs/quickstart"],
    ["Frameworks", "/docs/frameworks"],
    ["Server-side", "/docs/server-side"],
  ];

  return (
    <footer className="relative mt-24 overflow-hidden border-t border-white/[0.1] bg-sidebar">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 pt-12 sm:flex-row sm:items-start sm:justify-between sm:px-6 lg:px-10">
        <p className="max-w-xs text-sm leading-[22px] text-zinc-400">
          Install the tracker, record events and call the API. Guides for every framework, language and platform.
        </p>
        <ul className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          {links.map(([label, href]) => (
            <li key={href}>
              <Link href={href} className="no-underline-link text-zinc-400 transition-colors duration-150 hover:text-zinc-100">
                {label}
              </Link>
            </li>
          ))}
          {DASHBOARD_URL && (
            <li>
              <a href={DASHBOARD_URL} className="no-underline-link inline-flex items-center gap-1 text-zinc-400 transition-colors duration-150 hover:text-zinc-100">
                Dashboard <ArrowUpRight className="h-4 w-4" />
              </a>
            </li>
          )}
        </ul>
      </div>

      <div className="relative mt-10 h-[130px] sm:h-[190px]" aria-hidden="true">
        <GlyphField variant="text" text={PRODUCT} cell={9} interactive />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[#0f0f10] to-transparent" />
      </div>

      <div className="relative border-t border-white/[0.08]">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-5 text-[13px] text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
          <p>© {new Date().getFullYear()} {PRODUCT}</p>
          <p className="font-mono text-xs">Go edge · Kafka · ClickHouse</p>
        </div>
      </div>
    </footer>
  );
}
