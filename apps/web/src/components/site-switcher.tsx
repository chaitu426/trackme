"use client";

import { MenuPanel } from "@/components/ui/menu-panel";
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
      if (ref.current && !ref.current.contains(event.target as Node) && !(event.target as Element).closest?.("[data-portal-menu]")) setOpen(false);
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
          className="flex max-w-[190px] items-center gap-2 rounded-md px-2 py-1 text-left text-xs font-medium text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100"
        >
          <Globe className="h-4 w-4 shrink-0 text-zinc-600" />
          <span className="truncate font-mono text-xs">{currentSite?.displayName || currentDomain}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-600" />
        </button>

        <MenuPanel open={open} role="dialog" aria-label="Switch site" className="left-0 top-full mt-2 w-72 overflow-hidden p-2">
            <div className="flex items-center justify-between px-3 pb-2 pt-1">
              <p className="text-xs font-medium text-zinc-500">
                Websites ({sites.length})
              </p>
              {workspaceId && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setShowAddModal(true);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-zinc-300 hover:text-zinc-300 transition"
                >
                  <Plus className="h-4 w-4" /> Add Site
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
                    className={`flex items-center gap-3 rounded-lg px-2 py-2 transition ${
                      isCurrent ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.06]">
                      <Globe className="h-4 w-4 text-zinc-400" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-zinc-200">
                        {site.displayName || site.domain}
                      </span>
                      <span className="block truncate font-mono text-xs text-zinc-500">{site.domain}</span>
                    </span>
                    {isCurrent && <Check className="h-4 w-4 text-zinc-100" />}
                  </Link>
                );
              })}
            </div>

            <div className="mt-2 border-t border-white/[0.06] px-1 pt-2 space-y-0.5">
              {workspaceId && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setShowAddModal(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.04] transition"
                >
                  <Plus className="h-4 w-4" /> Add Website to Org
                </button>
              )}
              {currentDomain && (
                <Link
                  href={`/${workspaceSlug}/sites/${currentDomain}/settings`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-md px-2 py-2 text-xs font-medium text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100"
                >
                  <Settings2 className="h-4 w-4" /> Site Settings & Snippet
                </Link>
              )}
            </div>
        </MenuPanel>
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
