"use client";

import * as React from "react";
import { Menu, Shield, ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { SiteSwitcher } from "@/components/site-switcher";

interface DashboardShellProps {
  children: React.ReactNode;
  workspace: { id: string; name: string; slug: string };
  workspaces: { id: string; name: string; slug: string; role: string }[];
  sites: { id: string; domain: string; displayName: string }[];
  primarySiteDomain: string;
  user: { id: string; email: string };
}

export function DashboardShell({
  children,
  workspace,
  workspaces,
  sites,
  primarySiteDomain,
  user,
}: DashboardShellProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("trackme_sidebar_collapsed");
      if (saved !== null) {
        setCollapsed(saved === "true");
      }
    } catch {
      // Ignore
    }
  }, []);

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("trackme_sidebar_collapsed", String(next));
      } catch {
        // Ignore
      }
      return next;
    });
  };

  const currentWorkspace = {
    ...workspace,
    role: workspaces.find((item) => item.id === workspace.id)?.role ?? "member",
  };
  const requestedSiteDomain = pathname.match(new RegExp(`^/${workspace.slug}/sites/([^/]+)`))?.[1];
  const activeSiteDomain =
    requestedSiteDomain && sites.some((site) => site.domain === requestedSiteDomain)
      ? requestedSiteDomain
      : primarySiteDomain;

  return (
    <div className="dashboard-shell relative flex min-h-screen flex-col bg-background antialiased">
      <Sidebar
        workspace={workspace}
        workspaces={workspaces}
        sites={sites}
        primarySiteDomain={activeSiteDomain}
        user={user}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div
        className={`
          flex-1 flex flex-col transition-all duration-300 ease-in-out
          ${collapsed ? "lg:ml-16" : "lg:ml-60"}
        `}
      >
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-white/[0.06] bg-background/80 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
              <OrganizationSwitcher current={currentWorkspace} workspaces={workspaces} />
              {activeSiteDomain && (
                <>
                  <ChevronRight className="h-3 w-3 shrink-0 text-zinc-700" />
                  <SiteSwitcher workspaceId={workspace.id} workspaceSlug={workspace.slug} currentDomain={activeSiteDomain} sites={sites} />
                </>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            <div className="flex items-center gap-1.5 rounded-md border border-emerald-500/15 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-400">
              <Shield className="h-3 w-3" strokeWidth={2.4} />
              <span className="hidden sm:inline">Cookieless · Privacy-safe</span>
              <span className="sm:hidden">Private</span>
            </div>

            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-semibold text-zinc-200">
              {user.email ? user.email.slice(0, 2).toUpperCase() : "TM"}
            </div>
          </div>
        </header>

        <main className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
