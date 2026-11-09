"use client";

import * as React from "react";
import { Menu, ChevronRight, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { SiteSwitcher } from "@/components/site-switcher";
import { CommandPalette, openCommandPalette } from "@/components/command-palette";
import { AskDock } from "@/components/ask/ask-dock";
import { Kbd } from "@/components/ui/field";
import { pageLabelFor } from "@/lib/nav";

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

  const pageLabel = pageLabelFor(pathname, workspace.slug);

  return (
    <div className="dashboard-shell relative flex min-h-screen flex-col bg-background antialiased">
      <Sidebar
        workspace={workspace}
        sites={sites}
        primarySiteDomain={activeSiteDomain}
        user={user}
        role={currentWorkspace.role}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div
        className={`
          flex-1 flex flex-col transition-[margin] duration-300 ease-in-out
          ${collapsed ? "lg:ml-16" : "lg:ml-60"}
        `}
      >
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="press flex size-8 items-center justify-center rounded-md border border-border text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-500">
              <OrganizationSwitcher current={currentWorkspace} workspaces={workspaces} />
              {activeSiteDomain && (
                <>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-700" />
                  <SiteSwitcher workspaceId={workspace.id} workspaceSlug={workspace.slug} currentDomain={activeSiteDomain} sites={sites} />
                </>
              )}
              {pageLabel && (
                <>
                  <ChevronRight className="hidden h-3 w-3 shrink-0 text-zinc-700 sm:block" />
                  <span className="hidden truncate text-zinc-300 sm:inline">{pageLabel}</span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Search pages and sites"
            className="press hidden h-8 shrink-0 items-center gap-3 rounded-lg border border-border bg-white/[0.02] pl-3 pr-2 text-xs text-zinc-500 hover:border-white/[0.16] hover:text-zinc-300 sm:flex"
          >
            <Search className="size-3.5" aria-hidden="true" />
            <span>Go to</span>
            <span className="flex gap-1">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Search pages and sites"
            className="press grid size-8 place-items-center rounded-md border border-border text-zinc-400 hover:text-zinc-100 sm:hidden"
          >
            <Search className="size-4" aria-hidden="true" />
          </button>
        </header>

        <CommandPalette workspaceSlug={workspace.slug} siteDomain={activeSiteDomain || null} sites={sites} />
        <AskDock workspaceSlug={workspace.slug} siteDomain={activeSiteDomain || null} sites={sites.map((x) => x.domain)} />
        <main className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-28 lg:pt-8">
          {children}
        </main>
      </div>
    </div>
  );
}
