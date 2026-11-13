"use client";

import type { Feature } from "@trackme/contracts";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, Globe, Plus, Search, type LucideIcon } from "lucide-react";
import { navTargets } from "@/lib/nav";
import { fuzzyFilter } from "@/lib/fuzzy";
import { Kbd } from "@/components/ui/field";
import { cn } from "@/lib/utils";

interface Command {
  id: string;
  label: string;
  group: string;
  href: string;
  icon: LucideIcon;
}

export const PALETTE_EVENT = "trackme:palette";

/** Opens the palette from anywhere (the header's search button). */
export function openCommandPalette(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PALETTE_EVENT));
}

/**
 * Go anywhere from the keyboard: Ctrl or Cmd + K opens it, type to narrow, arrows to move, Enter to go, Escape to close. It lists
 * every page (the same list as the sidebar), your other sites, and the actions people look for. Results are ranked by a
 * forgiving match, so "gh" finds Gateway Health. The highlighted row slides as you move, and the list scrolls the row into view.
 */
export function CommandPalette({ workspaceSlug, siteDomain, sites, allowedFeatures }: { workspaceSlug: string; siteDomain: string | null; sites: { id: string; domain: string; displayName: string }[]; allowedFeatures?: readonly Feature[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);

  const commands = React.useMemo<Command[]>(() => {
    const pages: Command[] = navTargets(workspaceSlug, siteDomain, allowedFeatures);
    const others: Command[] = sites
      .filter((s) => s.domain !== siteDomain)
      .map((s) => ({ id: `site:${s.id}`, label: `Switch to ${s.displayName || s.domain}`, group: "Sites", href: `/${workspaceSlug}/sites/${s.domain}/realtime`, icon: Globe }));
    const actions: Command[] = [{ id: "action:add-site", label: "Add a website", group: "Actions", href: `/${workspaceSlug}/settings/sites`, icon: Plus }];
    return [...pages, ...others, ...actions];
  }, [workspaceSlug, siteDomain, sites, allowedFeatures]);

  const results = React.useMemo(() => fuzzyFilter(commands, query, (c) => `${c.label} ${c.group}`), [commands, query]);

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
    opener.current?.focus?.();
  }, []);

  React.useEffect(() => {
    const show = () => {
      opener.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open ? close() : show();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_EVENT, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_EVENT, show);
    };
  }, [open, close]);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Moving through the list keeps the highlighted row in view.
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(command: Command | undefined) {
    if (!command) return;
    close();
    router.push(command.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  let lastGroup = "";
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-start justify-center px-4 pt-[14vh]">
          <motion.div className="absolute inset-0 bg-black/70" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={close} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Go to"
            className="relative w-full max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-float"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-3 border-b border-white/[0.06] px-4">
              <Search className="size-4 shrink-0 text-zinc-500" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={results[active] ? `palette-${results[active]!.id}` : undefined}
                placeholder="Go to a page or site"
                className="h-12 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
              />
              <Kbd>Esc</Kbd>
            </div>

            <div ref={listRef} id="palette-list" role="listbox" className="max-h-[min(380px,50vh)] overflow-y-auto p-2">
              {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-zinc-500">Nothing matches &ldquo;{query}&rdquo;</p>}
              {results.map((c, i) => {
                const heading = c.group !== lastGroup && query.trim() === "" ? c.group : null;
                lastGroup = c.group;
                const Icon = c.icon;
                const on = i === active;
                return (
                  <React.Fragment key={c.id}>
                    {heading && <p className="px-3 pb-1 pt-3 text-xs text-zinc-500 first:pt-1">{heading}</p>}
                    <div
                      id={`palette-${c.id}`}
                      role="option"
                      aria-selected={on}
                      data-index={i}
                      onPointerMove={() => setActive(i)}
                      onClick={() => go(c)}
                      className={cn("relative flex h-9 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm", on ? "text-zinc-50" : "text-zinc-400")}
                    >
                      {on && <motion.span layoutId="palette-active" className="absolute inset-0 rounded-lg bg-raised shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" transition={{ type: "spring", bounce: 0, visualDuration: 0.18 }} />}
                      <Icon className={cn("relative size-4 shrink-0", on ? "text-zinc-100" : "text-zinc-500")} aria-hidden="true" />
                      <span className="relative flex-1 truncate">{c.label}</span>
                      {query.trim() !== "" && <span className="relative text-xs text-zinc-600">{c.group}</span>}
                      {on && <CornerDownLeft className="relative size-3.5 text-zinc-500" aria-hidden="true" />}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            <div className="flex items-center gap-4 border-t border-white/[0.06] px-4 py-2 text-xs text-zinc-500">
              <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
              <span className="flex items-center gap-1.5"><Kbd>Enter</Kbd> open</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
