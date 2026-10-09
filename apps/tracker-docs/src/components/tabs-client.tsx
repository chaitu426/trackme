"use client";

import * as React from "react";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

export interface TabItem {
  label: string;
  html: string;
  /** Shown in the header of the active panel, for example a file name. */
  filename?: string | undefined;
  languageLabel: string;
}

const EVENT = "trackme-docs-tab";

function readStored(group: string): string | null {
  try {
    return window.localStorage.getItem(`trackme_docs_tab_${group}`);
  } catch {
    return null;
  }
}

/**
 * Tabbed code samples. Tabs that share a `group` stay in step across the page and
 * remember the reader's choice, so choosing "pnpm" once switches every install
 * command.
 */
export function CodeTabs({ items, group }: { items: TabItem[]; group?: string | undefined }) {
  const [active, setActive] = React.useState(items[0]?.label ?? "");

  React.useEffect(() => {
    if (!group) return;
    const stored = readStored(group);
    if (stored && items.some((item) => item.label === stored)) setActive(stored);

    function onChange(event: Event) {
      const detail = (event as CustomEvent<{ group: string; label: string }>).detail;
      if (detail.group === group && items.some((item) => item.label === detail.label)) {
        setActive(detail.label);
      }
    }
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [group, items]);

  function select(label: string) {
    setActive(label);
    if (!group) return;
    try {
      window.localStorage.setItem(`trackme_docs_tab_${group}`, label);
    } catch {
      // Remembering the choice is a convenience only.
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { group, label } }));
  }

  const current = items.find((item) => item.label === active) ?? items[0];

  return (
    <figure
      data-code-root
      className="not-prose my-5 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0c0c0e]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] bg-white/[0.02] pl-1.5 pr-1.5">
        <div role="tablist" className="flex min-w-0 items-center gap-0.5 overflow-x-auto py-1.5">
          {items.map((item) => {
            const selected = item.label === current?.label;
            return (
              <button
                key={item.label}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => select(item.label)}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition",
                  selected
                    ? "bg-white/[0.08] text-zinc-50"
                    : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {current?.filename && (
            <span className="hidden font-mono text-[11px] text-zinc-500 md:inline">{current.filename}</span>
          )}
          <CopyButton />
        </div>
      </div>
      {items.map((item) => (
        <div
          key={item.label}
          role="tabpanel"
          data-code-panel
          hidden={item.label !== current?.label}
          className="code-body"
          dangerouslySetInnerHTML={{ __html: item.html }}
        />
      ))}
    </figure>
  );
}
