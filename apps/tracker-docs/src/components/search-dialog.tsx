"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";
import { ALL_PAGES, groupOf, type NavItem } from "@/lib/nav";
import { NavIcon } from "@/components/nav-icons";
import { cn } from "@/lib/utils";

function score(page: NavItem, terms: string[]): number {
  const title = page.title.toLowerCase();
  const description = page.description.toLowerCase();
  const group = (groupOf(page.href) ?? "").toLowerCase();
  const keywords = (page.keywords ?? []).map((k) => k.toLowerCase());

  let total = 0;
  for (const term of terms) {
    let best = 0;
    if (title === term) best = 12;
    else if (title.startsWith(term)) best = 9;
    else if (title.includes(term)) best = 7;
    if (keywords.some((k) => k === term)) best = Math.max(best, 8);
    else if (keywords.some((k) => k.includes(term))) best = Math.max(best, 4);
    if (description.includes(term)) best = Math.max(best, 2);
    if (group.includes(term)) best = Math.max(best, 1);
    if (best === 0) return 0; // every term must match something
    total += best;
  }
  return total;
}

export function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-8 w-full max-w-[18rem] items-center gap-2 rounded-md border border-white/10 bg-white/[0.02] px-2.5 text-xs text-zinc-500 transition hover:border-white/20 hover:text-zinc-300"
      aria-label="Search the documentation"
    >
      <Search className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate text-left">Search docs…</span>
      <kbd className="hidden rounded border border-white/10 bg-white/[0.04] px-1.5 font-mono text-[10px] text-zinc-500 sm:inline">
        ⌘K
      </kbd>
    </button>
  );
}

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const results = React.useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return ALL_PAGES.slice(0, 8);
    return ALL_PAGES.map((page) => ({ page, value: score(page, terms) }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((entry) => entry.page);
  }, [query]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  React.useEffect(() => setActive(0), [query]);

  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function go(page: NavItem | undefined) {
    if (!page) return;
    onClose();
    router.push(page.href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[active]);
    } else if (event.key === "Escape") {
      onClose();
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Search the documentation" className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-slide-down relative w-full max-w-xl overflow-hidden rounded-xl border border-white/10 bg-zinc-950 shadow-float">
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-3.5">
          <Search className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages, frameworks, options…"
            spellCheck={false}
            autoComplete="off"
            aria-label="Search"
            className="h-12 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          <kbd className="rounded border border-white/10 px-1.5 font-mono text-[10px] text-zinc-500">esc</kbd>
        </div>

        <ul ref={listRef} role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-zinc-500">
              Nothing matches “{query}”. Try a framework name, an option, or an error code.
            </li>
          )}
          {results.map((page, index) => (
            <li key={page.href} role="option" aria-selected={index === active} data-index={index}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => go(page)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition",
                  index === active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-zinc-400">
                  <NavIcon name={page.icon} className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-zinc-100">{page.title}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-zinc-600">{groupOf(page.href)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-500">{page.description}</span>
                </span>
                {index === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
