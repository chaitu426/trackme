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
    <div className="flex h-full flex-col justify-between overflow-hidden border-r border-white/[0.06] bg-background">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={cn("flex items-center justify-between border-b border-white/[0.06] p-3", compact && "flex-col gap-2")}>
          <Link href="/" className="no-underline-link flex min-w-0 items-center space-x-2.5 overflow-hidden">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-950 transition hover:bg-white">
              <Activity className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
            {!compact && (
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-semibold tracking-tight text-zinc-100">{PRODUCT}</span>
                <span className="text-[11px] text-zinc-500">Developer docs</span>
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-200 lg:flex"
          >
            {compact ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        <nav aria-label="Documentation" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2 py-3">
          {NAV.map((group) => (
            <div key={group.title} className="space-y-1">
              {!compact && (
                <div className="px-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-600">
                  {group.title}
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
                        "no-underline-link group relative flex items-center rounded-md text-[13px] font-medium transition duration-150",
                        compact ? "mx-auto h-9 w-9 justify-center" : "space-x-2.5 px-2.5 py-1.5",
                        isActive
                          ? "bg-white/[0.08] text-zinc-50"
                          : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
                      )}
                    >
                      <NavIcon
                        name={item.icon}
                        className={cn("h-4 w-4 shrink-0", isActive ? "text-zinc-100" : "text-zinc-500 group-hover:text-zinc-300")}
                      />
                      {!compact && <span className="flex-1 truncate">{item.title}</span>}
                      {!compact && item.badge === "new" && (
                        <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-blue-400">
                          New
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {!compact && (
        <div className="border-t border-white/[0.06] p-3">
          {DASHBOARD_URL ? (
            <a
              href={DASHBOARD_URL}
              className="no-underline-link flex items-center justify-between rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.04] hover:text-zinc-50"
            >
              Open dashboard
              <ExternalLink className="h-3.5 w-3.5 text-zinc-500" />
            </a>
          ) : (
            <p className="text-[11px] leading-relaxed text-zinc-600">
              Site key and snippet live under <span className="text-zinc-400">Site &amp; Snippet</span> in your dashboard.
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
          "fixed inset-y-0 left-0 z-40 hidden transition-all duration-300 ease-in-out lg:block",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {content(collapsed)}
      </aside>

      {mobileOpen && (
        <div role="dialog" aria-modal="true" aria-label="Navigation" className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onMobileClose} />
          <div className="relative h-full w-72 max-w-[85vw] border-r border-white/[0.06] bg-background shadow-float">
            {content(false)}
          </div>
        </div>
      )}
    </>
  );
}
