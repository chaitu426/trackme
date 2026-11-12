"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import {
  ChevronDown,
  LogOut,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  Users,
  CreditCard,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { NAV_SUITES, SITE_SETTINGS_ITEM } from "@/lib/nav";
import { Tooltip } from "@/components/ui/tooltip";
import { PortalMenu } from "@/components/ui/menu-panel";
import { LogoMark } from "@/components/brand/logo-mark";

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
  const profileButtons = React.useRef<Record<string, HTMLButtonElement | null>>({});
  // Only the sidebar that is on screen opens the menu; the other is mounted but hidden.
  const visibleScope = mobileOpen ? "drawer" : "desktop";

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Element;
      if (target.closest?.("[data-portal-menu]")) return;
      if (profileMenuRef.current && !profileMenuRef.current.contains(target)) {
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
        { href: `/${workspace.slug}/settings/billing`, label: "Plan & billing", icon: CreditCard },
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

  const renderContent = (collapsed: boolean, scope: "desktop" | "drawer" = "desktop") => (
    <div className="flex h-full flex-col justify-between overflow-hidden border-r border-border bg-sidebar">
      <div>
        <div className={`flex h-14 items-center border-b border-border px-3 ${collapsed ? "justify-center" : "justify-between"}`}>
          {collapsed ? (
            // Collapsed, the logo is the only thing in the header. Hover or focus turns it into the expand control.
            <Tooltip content="Expand sidebar" side="right">
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label="Expand sidebar"
                className="group press relative grid size-9 place-items-center rounded-lg hover:bg-white/[0.06] focus-visible:bg-white/[0.06]"
              >
                <span className="transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0">
                  <LogoMark />
                </span>
                <PanelLeftOpen className="absolute size-4 text-zinc-200 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
              </button>
            </Tooltip>
          ) : (
            <>
              <Link href={`/${workspace.slug}/overview`} aria-label="TrackMe home" className="press flex min-w-0 items-center gap-3 rounded-md">
                <LogoMark />
                <span className="text-base font-medium leading-none text-zinc-100">TrackMe</span>
              </Link>
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label="Collapse sidebar"
                className="press hidden size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 lg:flex"
              >
                <PanelLeftClose className="size-4" aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        <LayoutGroup id={`sidebar-${scope}-${collapsed ? "rail" : "full"}`}>
        <div className="max-h-[calc(100vh-180px)] space-y-6 overflow-y-auto px-2 py-4">
          {navGroups.map((group) => {
            const open = collapsed || !closedSuites.includes(group.id);
            return (
            <div key={group.id} className={collapsed ? "space-y-1 border-t border-white/[0.06] pt-4 first:border-0 first:pt-0" : "space-y-1"}>
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

                  const link = (
                    <Link
                      key={item.label}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={`
                        group press relative flex items-center rounded-lg text-sm
                        ${collapsed ? "mx-auto h-8 w-8 justify-center" : "h-8 gap-3 px-3"}
                        ${isActive ? "font-medium text-zinc-50" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"}
                      `}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="sidebar-active"
                          className="absolute inset-0 rounded-lg bg-raised shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                          transition={{ type: "spring", bounce: 0, visualDuration: 0.28 }}
                        />
                      )}
                      <Icon className={`relative h-4 w-4 shrink-0 transition-colors duration-150 ${isActive ? "text-zinc-100" : "text-zinc-500 group-hover:text-zinc-300"}`} />

                      {!collapsed && <span className="relative flex-1 truncate">{item.label}</span>}

                      {!collapsed && item.badge === "live" && (
                        <span className="relative h-1.5 w-1.5 rounded-full bg-good pulse-live" aria-label="Live" />
                      )}
                    </Link>
                  );
                  return collapsed ? (
                    <Tooltip key={item.label} content={item.label} side="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
        </LayoutGroup>
      </div>

      <div className="relative border-t border-border p-2" ref={profileMenuRef}>
        <PortalMenu
          open={profileOpen && scope === visibleScope}
          anchor={() => profileButtons.current[scope]}
          placement={collapsed ? "right-end" : "above-start"}
          role="menu"
          aria-label="Account"
          className="p-2"
          onEscape={() => setProfileOpen(false)}
        >
            <div className="border-b border-white/[0.06] px-3 py-2">
              <p className="truncate text-xs font-medium text-zinc-100">{user.email}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-good" />
                <span className="font-mono text-xs text-zinc-500">{workspace.slug} · {roleLabel}</span>
              </div>
            </div>

            <div className="space-y-0.5 py-1 text-xs font-medium">
              <Link
                href={`/${workspace.slug}/settings`}
                onClick={() => setProfileOpen(false)}
                className="press flex items-center gap-2 rounded-md px-3 py-2 text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
              >
                <Settings2 className="h-4 w-4" />
                <span>Workspace Settings</span>
              </Link>
              <Link
                href="/onboarding"
                onClick={() => setProfileOpen(false)}
                className="press flex items-center gap-2 rounded-md px-3 py-2 text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
              >
                <Plus className="h-4 w-4" />
                <span>Create New Workspace</span>
              </Link>
            </div>

            <div className="border-t border-white/[0.06] pt-1">
              <button
                type="button"
                onClick={handleLogout}
                className="press flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-bad hover:bg-bad/10"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign Out</span>
              </button>
            </div>
        </PortalMenu>

        <button
          type="button"
          ref={(el) => {
            profileButtons.current[scope] = el;
          }}
          aria-haspopup="menu"
          aria-expanded={profileOpen && scope === visibleScope}
          onClick={() => setProfileOpen(!profileOpen)}
          className={`press flex w-full items-center rounded-md p-2 text-left hover:bg-white/[0.04] ${collapsed ? "justify-center" : "gap-3"} ${profileOpen ? "bg-white/[0.06]" : ""}`}
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
        className={`hidden lg:block fixed inset-y-0 left-0 z-40 transition-[width] duration-300 ease-in-out ${collapsed ? "w-16" : "w-60"}`}
      >
        {renderContent(collapsed)}
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <div role="dialog" aria-modal="true" aria-label="Navigation" className="fixed inset-0 z-50 flex lg:hidden">
            <motion.div className="fixed inset-0 bg-black/70" aria-hidden="true" onClick={onMobileClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
            <motion.div
              className="relative h-full w-72 max-w-[85vw] border-r border-white/[0.06] bg-background shadow-float"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }}
            >
              {renderContent(false, "drawer")}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
