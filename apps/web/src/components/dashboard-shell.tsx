"use client";

import * as React from "react";
import { Menu, Shield, ChevronRight } from "lucide-react";
import { Sidebar } from "@/components/sidebar";

interface DashboardShellProps {
  children: React.ReactNode;
  workspace: { id: string; name: string; slug: string };
  primarySiteDomain: string;
  user: { id: string; email: string };
}

export function DashboardShell({
  children,
  workspace,
  primarySiteDomain,
  user,
}: DashboardShellProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Restore collapsed state from localStorage on mount
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("trackme_sidebar_collapsed");
      if (saved !== null) {
        setCollapsed(saved === "true");
      }
    } catch {
      // LocalStorage not available or restricted
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

  return (
    <div className="min-h-screen bg-[#f7f8fa] relative flex flex-col antialiased">

      {/* Sidebar Navigation */}
      <Sidebar
        workspace={workspace}
        primarySiteDomain={primarySiteDomain}
        user={user}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      {/* Main Content Area */}
      <div
        className={`
          flex-1 flex flex-col transition-all duration-300 ease-in-out
          ${collapsed ? "lg:ml-16" : "lg:ml-60"}
        `}
      >
        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-200/80 bg-white/80 px-4 sm:px-6 backdrop-blur-md">
          {/* Left: Mobile trigger & breadcrumbs */}
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden flex h-8 w-8 items-center justify-center rounded-lg text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>

            {/* Breadcrumb path */}
            <div className="flex items-center space-x-2 text-xs">
              <span className="font-semibold text-zinc-800">
                {workspace.name}
              </span>
              {primarySiteDomain && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-300" />
                  <span className="font-mono text-zinc-500 font-medium hidden sm:inline">
                    {primarySiteDomain}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Right: Quick actions & Trust Badge */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200/60 text-[11px] text-emerald-700 font-medium">
              <Shield className="w-3 h-3 text-emerald-600" strokeWidth={2.5} />
              <span className="hidden sm:inline">Cookieless · GDPR Compliant</span>
              <span className="sm:hidden">GDPR</span>
            </div>

            <div className="h-7 w-7 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[10px] font-bold shadow-xs select-none">
              {user.email ? user.email.slice(0, 2).toUpperCase() : "TM"}
            </div>
          </div>
        </header>

        {/* Dynamic Page Content */}
        <main className="relative z-10 flex-1 px-4 sm:px-6 lg:px-8 py-6 sm:py-8 max-w-[1400px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
