"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  ChevronDown,
  LogOut,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  Users,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { NAV_SUITES, SITE_SETTINGS_ITEM } from "@/lib/nav";

const SUITES_STORAGE_KEY = "trackme_sidebar_closed_suites";
interface SidebarProps {
  workspace: { id: string; name: string; slug: string };
  sites: { id: string; domain: string; displayName: string }[];
  primarySiteDomain: string;
  user: { id: string; email: string };
  role: string;
  mobileOpen: boolean;
  onMobileClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  workspace,
  sites,
  primarySiteDomain,
  user,
  role,
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

  // With no website yet there is no site to open: send site-scoped items to the page that adds one,
  // instead of a broken /sites//realtime URL.
  const siteBase = primarySiteDomain ? `/${workspace.slug}/sites/${primarySiteDomain}` : null;
  const siteHref = (section: string) => (siteBase ? `${siteBase}/${section}` : `/${workspace.slug}/settings/sites`);

  type NavItem = { href: string; label: string; icon: LucideIcon; badge?: "live" | "new"; scoped?: boolean };
  type NavGroup = { id: string; title: string; items: NavItem[] };

  const navGroups: NavGroup[] = [
    ...NAV_SUITES.map((suite) => ({
      id: suite.id,
      title: suite.title,
      items: suite.items.map((item): NavItem => ({
        href: item.workspace ? `/${workspace.slug}/${item.path}` : siteHref(item.path),
        label: item.label,
        icon: item.icon,
        ...(item.badge ? { badge: item.badge } : {}),
        ...(item.workspace ? {} : { scoped: true }),
      })),
    })),
    {
      id: "workspace",
      title: "Workspace",
      items: [
        { href: `/${workspace.slug}/settings`, label: "Organization & Team", icon: Users },
        { href: `/${workspace.slug}/settings/sites`, label: `Websites (${sites.length})`, icon: Globe },
        { href: siteHref(SITE_SETTINGS_ITEM.path), label: SITE_SETTINGS_ITEM.label, icon: SITE_SETTINGS_ITEM.icon, scoped: true },
        { href: "/legal/privacy", label: "Privacy Policy", icon: BookOpen },
      ],
    },
  ];

  // An item is active when the path is its href or a child of it, and no other nav item
  // matches more specifically (so /settings does not light up on /settings/sites).
  const allHrefs = navGroups.flatMap((group) => group.items.map((item) => item.href));
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const activeHref = allHrefs.filter(matches).sort((a, b) => b.length - a.length)[0];
  const activeSuiteId = navGroups.find((group) => group.items.some((item) => item.href === activeHref))?.id;

  // Suites the user folded away, remembered across visits. Opening a page inside a folded suite unfolds it.
  const [closedSuites, setClosedSuites] = React.useState<string[]>([]);
  React.useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SUITES_STORAGE_KEY) ?? "[]");
      if (Array.isArray(saved)) {
        setClosedSuites(saved.filter((id): id is string => typeof id === "string" && id !== activeSuiteId));
      }
    } catch {
      // storage unavailable or corrupt: start with everything open
    }
  }, []);
  const persistClosed = (next: string[]) => {
    setClosedSuites(next);
    try {
      localStorage.setItem(SUITES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // not persisted this time
    }
  };
  React.useEffect(() => {
    if (activeSuiteId && closedSuites.includes(activeSuiteId)) {
      persistClosed(closedSuites.filter((id) => id !== activeSuiteId));
    }
    // Only a page change should unfold a suite, not the user folding the one they are on.
  }, [activeHref]);
  const toggleSuite = (id: string) =>
    persistClosed(closedSuites.includes(id) ? closedSuites.filter((x) => x !== id) : [...closedSuites, id]);

  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const userInitials = user.email ? user.email.slice(0, 2).toUpperCase() : "TM";

  const renderContent = (collapsed: boolean) => (
    <div className="flex h-full flex-col justify-between overflow-hidden border-r border-border bg-sidebar">
      <div>
        <div className={`flex h-14 items-center justify-between border-b border-border px-3 ${collapsed ? "h-auto flex-col gap-2 py-3" : ""}`}>
          <div className="flex min-w-0 items-center space-x-3 overflow-hidden">
            <Link
              href={`/${workspace.slug}/overview`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-950 transition-colors hover:bg-white"
            >
              <Activity className="h-4 w-4" />
            </Link>
            {!collapsed && (
              <div className="flex min-w-0 flex-col">
                <span className="text-base font-medium leading-none text-zinc-100">TrackMe</span>
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

        <div className="max-h-[calc(100vh-180px)] space-y-6 overflow-y-auto px-2 py-4">
          {navGroups.map((group) => {
            const open = collapsed || !closedSuites.includes(group.id);
            return (
            <div key={group.id} className="space-y-1">
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleSuite(group.id)}
                  aria-expanded={open}
                  aria-controls={`suite-${group.id}`}
                  className="flex w-full items-center justify-between rounded-md px-3 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  <span>{group.title}</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? "" : "-rotate-90"}`} />
                </button>
              )}
              <div id={`suite-${group.id}`} hidden={!open} className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = item.href === activeHref && !(item.scoped && !siteBase);
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={`
                        group relative flex items-center rounded-lg text-sm transition-colors duration-150
                        ${collapsed ? "mx-auto h-8 w-8 justify-center" : "h-8 gap-3 px-3"}
                        ${
                          isActive
                            ? "bg-raised font-medium text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                            : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
                        }
                      `}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-zinc-100" : "text-zinc-500 group-hover:text-zinc-300"}`} />

                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}

                      {!collapsed && item.badge === "live" && (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#4cc38a] pulse-live" aria-label="Live" />
                      )}

                      {collapsed && (
                        <div className="absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs text-zinc-100 shadow-float group-hover:block">
                          {item.label}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      <div className="relative border-t border-border p-2" ref={profileMenuRef}>
        {profileOpen && (
          <div
            className={`absolute bottom-full z-50 mb-2 rounded-xl border border-border bg-card p-2 shadow-float ${collapsed ? "left-2 w-56" : "left-2 right-2"}`}
          >
            <div className="border-b border-white/[0.06] px-3 py-2">
              <p className="truncate text-xs font-medium text-zinc-100">{user.email}</p>
              <div className="mt-1 flex items-center space-x-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[#4cc38a]" />
                <span className="font-mono text-xs text-zinc-500">{workspace.slug} · {roleLabel}</span>
              </div>
            </div>

            <div className="space-y-0.5 py-1 text-xs font-medium">
              <Link
                href={`/${workspace.slug}/settings`}
                onClick={() => setProfileOpen(false)}
                className="flex items-center space-x-2 rounded-md px-3 py-2 text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
              >
                <Settings2 className="h-4 w-4" />
                <span>Workspace Settings</span>
              </Link>
              <Link
                href="/onboarding"
                onClick={() => setProfileOpen(false)}
                className="flex items-center space-x-2 rounded-md px-3 py-2 text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
              >
                <Plus className="h-4 w-4" />
                <span>Create New Workspace</span>
              </Link>
            </div>

            <div className="border-t border-white/[0.06] pt-1">
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center space-x-2 rounded-md px-3 py-2 text-xs font-medium text-[#e5484d] transition hover:bg-[#e5484d]/10"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setProfileOpen(!profileOpen)}
          className={`flex w-full items-center rounded-md p-2 text-left transition hover:bg-white/[0.04] ${collapsed ? "justify-center" : "space-x-3"} ${profileOpen ? "bg-white/[0.06]" : ""}`}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-medium text-zinc-200">
            {userInitials}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-zinc-200">{user.email}</p>
              <p className="truncate text-xs text-zinc-500">Workspace {roleLabel}</p>
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
        {renderContent(collapsed)}
      </aside>

      {mobileOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onMobileClose} />
          <div className="relative h-full w-72 max-w-[85vw] border-r border-white/[0.06] bg-background shadow-float">
            {renderContent(false)}
          </div>
        </div>
      )}
    </>
  );
}
