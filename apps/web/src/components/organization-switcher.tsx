"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ChevronDown, Plus, Search } from "lucide-react";

type Workspace = { id: string; name: string; slug: string; role: string };

export function OrganizationSwitcher({
  current,
  workspaces,
}: {
  current: Workspace;
  workspaces: Workspace[];
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  React.useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
    else setQuery("");
  }, [open]);

  const matches = workspaces.filter((workspace) =>
    workspace.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex max-w-[150px] items-center gap-1 rounded-md px-1 py-0.5 text-left text-[11px] font-medium text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-200"
      >
        <span className="truncate">{current.name}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Switch organization"
          className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-lg border border-white/10 bg-zinc-950 p-1.5 shadow-float"
        >
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">Organizations</p>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2">
              <Search className="h-3.5 w-3.5 text-zinc-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search organizations..."
                className="w-full bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto px-1">
            {matches.map((workspace) => {
              const isCurrent = workspace.id === current.id;
              return (
                <Link
                  key={workspace.id}
                  href={`/${workspace.slug}/overview`}
                  onClick={() => {
                    localStorage.setItem("trackme_last_workspace", workspace.slug);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2.5 rounded-md px-2 py-2.5 transition hover:bg-white/[0.04]"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-[10px] font-semibold text-zinc-300">
                    {workspace.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-zinc-200">{workspace.name}</span>
                    <span className="block text-[10px] capitalize text-zinc-500">{workspace.role}</span>
                  </span>
                  {isCurrent && <Check className="h-3.5 w-3.5 text-zinc-100" />}
                </Link>
              );
            })}
            {matches.length === 0 && (
              <p className="px-2 py-5 text-center text-xs text-zinc-500">No organizations found.</p>
            )}
          </div>
          <div className="mt-1 border-t border-white/[0.06] px-1 pt-1">
            <Link
              href="/onboarding"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-xs font-medium text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100"
            >
              <Plus className="h-3.5 w-3.5" />
              Create organization
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
