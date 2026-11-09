"use client";

import * as React from "react";
import { Menu, ChevronRight } from "lucide-react";
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
  featureFlags: string[];
  user: { id: string; email: string };
}

export function DashboardShell({
  children,
  workspace,
  workspaces,
  sites,
  primarySiteDomain,
  featureFlags,
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

  const PAGE_LABELS: Record<string, string> = {
    overview: "Overview",
    realtime: "Realtime",
    people: "User Profiles",
    journeys: "User Journeys",
    funnels: "Funnels",
    acquisition: "Acquisition",
    geography: "Audience Geography",
    events: "Goals & Events",
    vitals: "Web Vitals",
    pages: "Page Performance",
    errors: "Error Tracking",
    retention: "Retention & Cohorts",
  };
  const segments = pathname.split("/").filter(Boolean);
  const pageLabel = (() => {
    if (segments[1] === "settings") return segments[2] === "sites" ? "Websites" : "Organization & Team";
    if (segments[1] === "sites") return segments[3] === "settings" ? "Site Settings" : PAGE_LABELS[segments[3] ?? ""];
    return PAGE_LABELS[segments[1] ?? ""];
  })();

  return (
    <div className="dashboard-shell relative flex min-h-screen flex-col bg-background antialiased">
      <Sidebar
        workspace={workspace}
        sites={sites}
        primarySiteDomain={activeSiteDomain}
        featureFlags={featureFlags}
        user={user}
        role={currentWorkspace.role}
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
        <header className="sticky top-0 z-30 flex h-14 items-center justify-start border-b border-border bg-background px-4 sm:px-6">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100 lg:hidden"
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

        </header>

        <main className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
