"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ExternalLink, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV } from "@/lib/nav";
import { NavIcon } from "@/components/nav-icons";
import { DASHBOARD_URL, PRODUCT } from "@/lib/site";
import { cn } from "@/lib/utils";

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose, collapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const activeRef = React.useRef<HTMLAnchorElement | null>(null);

  React.useEffect(() => {
    onMobileClose();
  }, [pathname, onMobileClose]);

  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [pathname, collapsed]);

  const content = (compact: boolean) => (
    <div className="flex h-full flex-col justify-between overflow-hidden border-r border-white/[0.08] bg-sidebar">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={cn("flex h-14 items-center justify-between border-b border-white/[0.08] px-3", compact && "h-auto flex-col gap-2 py-3")}>
          <Link href="/" className="no-underline-link flex min-w-0 items-center gap-2 overflow-hidden">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#ededed] text-[#141415]">
              <Activity className="h-4 w-4" />
            </span>
            {!compact && (
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="text-base font-medium leading-none text-zinc-50">{PRODUCT}</span>
                <span className="font-mono text-xs text-zinc-500">docs</span>
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-200 lg:flex"
          >
            {compact ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        <nav aria-label="Documentation" className="min-h-0 flex-1 space-y-6 overflow-y-auto px-2 py-4">
          {NAV.map((group, groupIndex) => (
            <div key={group.title} className="space-y-2">
              {!compact && (
                <div className="flex items-center gap-2 px-3 font-mono text-xs text-zinc-500">
                  <span className="text-zinc-600">{String(groupIndex + 1).padStart(2, "0")}</span>
                  <span>{group.title}</span>
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = pathname === item.href || (pathname === `${item.href}/` && item.href !== "/docs");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      ref={isActive ? activeRef : undefined}
                      title={compact ? item.title : undefined}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "no-underline-link group relative flex items-center rounded-lg text-sm transition-colors duration-150",
                        compact ? "mx-auto h-8 w-8 justify-center" : "h-8 gap-3 px-3",
                        isActive
                          ? "bg-raised font-medium text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                          : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
                      )}
                    >
                      <NavIcon
                        name={item.icon}
                        className={cn("h-4 w-4 shrink-0", isActive ? "text-zinc-100" : "text-zinc-500 group-hover:text-zinc-300")}
                      />
                      {!compact && <span className="flex-1 truncate">{item.title}</span>}
                      {!compact && item.badge === "new" && <span className="font-mono text-xs text-good">new</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {!compact && (
        <div className="border-t border-white/[0.08] p-3">
          {DASHBOARD_URL ? (
            <a
              href={DASHBOARD_URL}
              className="no-underline-link flex h-9 items-center justify-between rounded-lg border border-white/[0.1] bg-[#19191b] px-3 text-[13px] text-zinc-200 transition-colors hover:border-white/[0.2]"
            >
              Open dashboard
              <ExternalLink className="h-4 w-4 text-zinc-500" />
            </a>
          ) : (
            <p className="px-1 text-xs leading-5 text-zinc-500">
              Site key and snippet live under <span className="text-zinc-300">Site Settings</span> in your dashboard.
            </p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden transition-[width] duration-300 ease-in-out lg:block",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {content(collapsed)}
      </aside>

      {mobileOpen && (
        <div role="dialog" aria-modal="true" aria-label="Navigation" className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/70" onClick={onMobileClose} />
          <div className="relative h-full w-72 max-w-[85vw] border-r border-white/[0.08] bg-sidebar shadow-float">
            {content(false)}
          </div>
        </div>
      )}
    </>
  );
}
