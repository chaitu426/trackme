"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ChevronDown, Globe, Settings2, Plus } from "lucide-react";
import { AddSiteModal } from "@/components/add-site-modal";

type Site = { id: string; domain: string; displayName: string };

export function SiteSwitcher({
  workspaceId,
  workspaceSlug,
  currentDomain,
  sites,
}: {
  workspaceId?: string;
  workspaceSlug: string;
  currentDomain: string;
  sites: Site[];
}) {
  const [open, setOpen] = React.useState(false);
  const [showAddModal, setShowAddModal] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const currentSite = sites.find((site) => site.domain === currentDomain);

  React.useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  if (!currentDomain && sites.length === 0) return null;

  return (
    <>
      <div className="relative min-w-0" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="flex max-w-[190px] items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100"
        >
          <Globe className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
          <span className="truncate font-mono text-[11px]">{currentSite?.displayName || currentDomain}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-zinc-600" />
        </button>

        {open && (
          <div
            role="dialog"
            aria-label="Switch site"
            className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-white/10 bg-zinc-950 p-1.5 shadow-2xl"
          >
            <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Websites ({sites.length})
              </p>
              {workspaceId && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setShowAddModal(true);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition"
                >
                  <Plus className="h-3 w-3" /> Add Site
                </button>
              )}
            </div>

            <div className="max-h-56 overflow-y-auto px-1">
              {sites.map((site) => {
                const isCurrent = site.domain === currentDomain;
                return (
                  <Link
                    key={site.id}
                    href={`/${workspaceSlug}/sites/${site.domain}/realtime`}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-2.5 rounded-lg px-2 py-2 transition ${
                      isCurrent ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.06]">
                      <Globe className="h-3.5 w-3.5 text-zinc-400" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-zinc-200">
                        {site.displayName || site.domain}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-zinc-500">{site.domain}</span>
                    </span>
                    {isCurrent && <Check className="h-3.5 w-3.5 text-zinc-100" />}
                  </Link>
                );
              })}
            </div>

            <div className="mt-1.5 border-t border-white/[0.06] px-1 pt-1.5 space-y-0.5">
              {workspaceId && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setShowAddModal(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-indigo-400 hover:bg-white/[0.04] transition"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Website to Org
                </button>
              )}
              {currentDomain && (
                <Link
                  href={`/${workspaceSlug}/sites/${currentDomain}/settings`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100"
                >
                  <Settings2 className="h-3.5 w-3.5" /> Site Settings & Snippet
                </Link>
              )}
            </div>
          </div>
        )}
      </div>

      {workspaceId && (
        <AddSiteModal
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </>
  );
}
