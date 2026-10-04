"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BarChart2,
  TrendingUp,
  Target,
  Gauge,
  Radio,
  Settings2,
  ShieldCheck,
  LogOut,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  MapPinned,
  Users,
  Globe,
  UserCheck,
  Filter,
} from "lucide-react";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { SiteSwitcher } from "@/components/site-switcher";

interface SidebarProps {
  workspace: { id: string; name: string; slug: string };
  workspaces: { id: string; name: string; slug: string; role: string }[];
  sites: { id: string; domain: string; displayName: string }[];
  primarySiteDomain: string;
  user: { id: string; email: string };
  mobileOpen: boolean;
  onMobileClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  workspace,
  workspaces,
  sites,
  primarySiteDomain,
  user,
  mobileOpen,
  onMobileClose,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [profileOpen, setProfileOpen] = React.useState(false);
  const profileMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    }
    if (profileOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [profileOpen]);

  React.useEffect(() => {
    onMobileClose();
  }, [pathname, onMobileClose]);

  const navGroups = [
    {
      title: "Analytics",
      items: [
        { href: `/${workspace.slug}/overview`, label: "Overview", icon: BarChart2, exact: true },
        { href: `/${workspace.slug}/sites/${primarySiteDomain}/realtime`, label: "Realtime", icon: Radio, badge: "live" },
        { href: `/${workspace.slug}/sites/${primarySiteDomain}/people`, label: "User Profiles", icon: UserCheck, badge: "new" },
        { href: `/${workspace.slug}/sites/${primarySiteDomain}/funnels`, label: "Funnels", icon: Filter, badge: "new" },
        { href: `/${workspace.slug}/sites/${primarySiteDomain}/acquisition`, label: "Acquisition", icon: TrendingUp },
        { href: `/${workspace.slug}/sites/${primarySiteDomain}/geography`, label: "Audience Geography", icon: MapPinned },
        { href: `/${workspace.slug}/sites/${primarySiteDomain}/events`, label: "Goals & Events", icon: Target },
        { href: `/${workspace.slug}/sites/${primarySiteDomain}/vitals`, label: "Web Vitals", icon: Gauge },
      ],
    },
    {
      title: "Workspace",
      items: [
        { href: `/${workspace.slug}/settings`, label: "Organization & Team", icon: Users },
        { href: `/${workspace.slug}/settings/sites`, label: `Websites (${sites.length})`, icon: Globe },
        { href: `/${workspace.slug}/sites/${primarySiteDomain}/settings`, label: "Site & Snippet", icon: Settings2 },
        { href: "/legal/dpa", label: "Compliance & DPA", icon: ShieldCheck },
        { href: "/legal/privacy", label: "Privacy Policy", icon: BookOpen },
      ],
    },
  ];

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const userInitials = user.email ? user.email.slice(0, 2).toUpperCase() : "TM";

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between overflow-hidden border-r border-white/[0.06] bg-background">
      <div>
        <div className={`flex items-center justify-between border-b border-white/[0.06] p-3 ${collapsed ? "flex-col gap-2" : ""}`}>
          <div className="flex min-w-0 items-center space-x-2.5 overflow-hidden">
            <Link
              href={`/${workspace.slug}/overview`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-950 transition hover:bg-white"
            >
              <Activity className="h-3.5 w-3.5" strokeWidth={2.5} />
            </Link>
            {!collapsed && (
              <div className="flex min-w-0 flex-col">
                <span className="text-[13px] font-semibold tracking-tight text-zinc-100">TrackMe</span>
                <OrganizationSwitcher
                  current={{
                    ...workspace,
                    role: workspaces.find((item) => item.id === workspace.id)?.role ?? "member",
                  }}
                  workspaces={workspaces}
                />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-200 lg:flex"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {!collapsed && primarySiteDomain && (
          <div className="px-3 pb-1 pt-3">
            <div className="flex items-center justify-between rounded-md border border-white/[0.06] bg-white/[0.02] px-1 py-0.5 text-xs text-zinc-300">
              <SiteSwitcher
                workspaceId={workspace.id}
                workspaceSlug={workspace.slug}
                currentDomain={primarySiteDomain}
                sites={sites}
              />
              <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 pulse-live" />
            </div>
          </div>
        )}

        <div className="max-h-[calc(100vh-180px)] space-y-5 overflow-y-auto px-2 py-3">
          {navGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              {!collapsed && (
                <div className="px-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-600">
                  {group.title}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={`
                        group relative flex items-center rounded-md text-[13px] font-medium transition duration-150
                        ${collapsed ? "mx-auto h-9 w-9 justify-center" : "space-x-2.5 px-2.5 py-1.5"}
                        ${
                          isActive
                            ? "bg-white/[0.08] text-zinc-50"
                            : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
                        }
                      `}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${isActive ? "text-zinc-100" : "text-zinc-500 group-hover:text-zinc-300"}`}
                        strokeWidth={isActive ? 2.25 : 2}
                      />

                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}

                      {!collapsed && item.badge === "live" && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-emerald-400">
                          <span className="h-1 w-1 rounded-full bg-emerald-400 pulse-live" />
                          Live
                        </span>
                      )}

                      {collapsed && (
                        <div className="absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-100 shadow-float group-hover:block">
                          {item.label}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="relative border-t border-white/[0.06] p-2" ref={profileMenuRef}>
        {profileOpen && (
          <div
            className={`absolute bottom-full z-50 mb-2 rounded-lg border border-white/10 bg-zinc-950 p-1.5 shadow-float ${collapsed ? "left-2 w-56" : "left-2 right-2"}`}
          >
            <div className="border-b border-white/[0.06] px-2.5 py-2">
              <p className="truncate text-xs font-medium text-zinc-100">{user.email}</p>
              <div className="mt-1 flex items-center space-x-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="font-mono text-[10px] text-zinc-500">{workspace.slug} · Owner</span>
              </div>
            </div>

            <div className="space-y-0.5 py-1 text-xs font-medium">
              <Link
                href={`/${workspace.slug}/sites/${primarySiteDomain}/settings`}
                onClick={() => setProfileOpen(false)}
                className="flex items-center space-x-2 rounded-md px-2.5 py-2 text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span>Workspace Settings</span>
              </Link>
              <Link
                href="/onboarding"
                onClick={() => setProfileOpen(false)}
                className="flex items-center space-x-2 rounded-md px-2.5 py-2 text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create New Workspace</span>
              </Link>
            </div>

            <div className="border-t border-white/[0.06] pt-1">
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center space-x-2 rounded-md px-2.5 py-2 text-xs font-medium text-rose-400 transition hover:bg-rose-500/10"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setProfileOpen(!profileOpen)}
          className={`flex w-full items-center rounded-md p-1.5 text-left transition hover:bg-white/[0.04] ${collapsed ? "justify-center" : "space-x-2.5"} ${profileOpen ? "bg-white/[0.06]" : ""}`}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-semibold text-zinc-200">
            {userInitials}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-zinc-200">{user.email}</p>
              <p className="truncate text-[10px] text-zinc-500">Workspace Owner</p>
            </div>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside
        className={`hidden lg:block fixed inset-y-0 left-0 z-40 transition-all duration-300 ease-in-out ${collapsed ? "w-16" : "w-60"}`}
      >
        {sidebarContent}
      </aside>

      {mobileOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onMobileClose} />
          <div className="relative h-full w-72 max-w-[85vw] border-r border-white/[0.06] bg-background shadow-float">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
