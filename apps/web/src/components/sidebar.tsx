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
  Globe,
  Plus,
} from "lucide-react";

interface SidebarProps {
  workspace: { id: string; name: string; slug: string };
  primarySiteDomain: string;
  user: { id: string; email: string };
  mobileOpen: boolean;
  onMobileClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  workspace,
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

  // Close profile menu when clicking outside
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

  // Close mobile drawer on route change
  React.useEffect(() => {
    onMobileClose();
  }, [pathname, onMobileClose]);

  const navGroups = [
    {
      title: "Analytics",
      items: [
        {
          href: `/${workspace.slug}/overview`,
          label: "Overview",
          icon: BarChart2,
          exact: true,
        },
        {
          href: `/${workspace.slug}/sites/${primarySiteDomain}/realtime`,
          label: "Realtime",
          icon: Radio,
          badge: "live",
        },
        {
          href: `/${workspace.slug}/sites/${primarySiteDomain}/acquisition`,
          label: "Acquisition",
          icon: TrendingUp,
        },
        {
          href: `/${workspace.slug}/sites/${primarySiteDomain}/events`,
          label: "Goals & Events",
          icon: Target,
        },
        {
          href: `/${workspace.slug}/sites/${primarySiteDomain}/vitals`,
          label: "Web Vitals",
          icon: Gauge,
        },
      ],
    },
    {
      title: "Workspace",
      items: [
        {
          href: `/${workspace.slug}/sites/${primarySiteDomain}/settings`,
          label: "Settings & Snippet",
          icon: Settings2,
        },
        {
          href: "/legal/dpa",
          label: "Compliance & DPA",
          icon: ShieldCheck,
        },
        {
          href: "/legal/privacy",
          label: "Privacy Policy",
          icon: BookOpen,
        },
      ],
    },
  ];

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const userInitials = user.email ? user.email.slice(0, 2).toUpperCase() : "TM";

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between overflow-hidden bg-white/95 backdrop-blur-md border-r border-zinc-200/80">
      {/* ── Top Header: Brand & Workspace ── */}
      <div>
        <div className={`flex items-center justify-between border-b border-zinc-100 p-3.5 ${collapsed ? "flex-col gap-2" : ""}`}>
          <Link
            href={`/${workspace.slug}/overview`}
            className="flex items-center space-x-2.5 group overflow-hidden"
          >
            <div className="h-8 w-8 rounded-xl bg-zinc-900 flex items-center justify-center shadow-xs group-hover:bg-zinc-800 transition shrink-0">
              <Activity className="w-4 h-4 text-zinc-100" strokeWidth={2.5} />
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-sm tracking-tight text-zinc-900 leading-tight">
                  TrackMe
                </span>
                <span className="text-[11px] font-medium text-zinc-400 truncate max-w-[120px]">
                  {workspace.name}
                </span>
              </div>
            )}
          </Link>

          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden lg:flex h-7 w-7 rounded-lg items-center justify-center text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer"
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* ── Active Site Pill (when expanded) ── */}
        {!collapsed && primarySiteDomain && (
          <div className="px-3.5 pt-3 pb-1">
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200/60 text-xs">
              <div className="flex items-center space-x-2 min-w-0">
                <Globe className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="font-mono text-zinc-700 text-[11px] font-semibold truncate">
                  {primarySiteDomain}
                </span>
              </div>
              <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            </div>
          </div>
        )}

        {/* ── Navigation Items ── */}
        <div className="px-2.5 py-3 space-y-5 overflow-y-auto max-h-[calc(100vh-180px)]">
          {navGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              {!collapsed && (
                <div className="px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  {group.title}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = item.exact
                    ? pathname === item.href
                    : pathname.startsWith(item.href);
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={`
                        group flex items-center rounded-xl text-xs font-medium transition duration-150 relative
                        ${collapsed ? "justify-center h-10 w-10 mx-auto" : "px-3 py-2 space-x-2.5"}
                        ${
                          isActive
                            ? "bg-zinc-900 text-white shadow-xs"
                            : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100/70"
                        }
                      `}
                    >
                      <Icon
                        className={`shrink-0 ${
                          collapsed ? "w-4 h-4" : "w-4 h-4"
                        } ${
                          isActive
                            ? "text-white"
                            : "text-zinc-500 group-hover:text-zinc-900"
                        }`}
                        strokeWidth={isActive ? 2.5 : 2}
                      />

                      {!collapsed && (
                        <span className="truncate flex-1">{item.label}</span>
                      )}

                      {!collapsed && item.badge === "live" && (
                        <span className="flex items-center space-x-1 px-1.5 py-0.2 rounded-full bg-emerald-500/10 text-emerald-600 text-[9px] font-bold uppercase tracking-wide">
                          <span className="h-1 w-1 rounded-full bg-emerald-500 animate-ping" />
                          <span>Live</span>
                        </span>
                      )}

                      {/* Tooltip for collapsed mode */}
                      {collapsed && (
                        <div className="absolute left-full ml-2 hidden group-hover:block z-50 px-2 py-1 bg-zinc-900 text-white text-[11px] font-medium rounded-md shadow-lg whitespace-nowrap">
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

      {/* ── Bottom Section: User Profile & Menu ── */}
      <div className="border-t border-zinc-100 p-2.5 relative" ref={profileMenuRef}>
        {/* Profile Popover Menu */}
        {profileOpen && (
          <div
            className={`
              absolute bottom-full mb-2 bg-white border border-zinc-200/90 rounded-2xl shadow-xl p-2 z-50 animate-in fade-in-0 zoom-in-95 duration-150
              ${collapsed ? "left-2 w-56" : "left-2 right-2"}
            `}
          >
            <div className="px-3 py-2 border-b border-zinc-100">
              <p className="text-xs font-semibold text-zinc-900 truncate">
                {user.email}
              </p>
              <div className="flex items-center space-x-1.5 mt-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="text-[10px] text-zinc-400 font-mono">
                  {workspace.slug} · Owner
                </span>
              </div>
            </div>

            <div className="py-1 space-y-0.5 text-xs font-medium">
              <Link
                href={`/${workspace.slug}/sites/${primarySiteDomain}/settings`}
                onClick={() => setProfileOpen(false)}
                className="flex items-center space-x-2 px-3 py-2 rounded-lg text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 transition"
              >
                <Settings2 className="w-3.5 h-3.5 text-zinc-400" />
                <span>Workspace Settings</span>
              </Link>
              <Link
                href="/onboarding"
                onClick={() => setProfileOpen(false)}
                className="flex items-center space-x-2 px-3 py-2 rounded-lg text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 transition"
              >
                <Plus className="w-3.5 h-3.5 text-zinc-400" />
                <span>Create New Workspace</span>
              </Link>
            </div>

            <div className="pt-1 border-t border-zinc-100">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center space-x-2 px-3 py-2 rounded-lg text-rose-600 hover:bg-rose-50 transition text-xs font-medium cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-500" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}

        {/* User Card Trigger */}
        <button
          type="button"
          onClick={() => setProfileOpen(!profileOpen)}
          className={`
            w-full flex items-center rounded-xl p-1.5 hover:bg-zinc-100/80 transition cursor-pointer text-left
            ${collapsed ? "justify-center" : "space-x-2.5"}
            ${profileOpen ? "bg-zinc-100" : ""}
          `}
        >
          <div className="h-8 w-8 rounded-full bg-zinc-900 text-white flex items-center justify-center text-xs font-bold shadow-xs shrink-0 select-none">
            {userInitials}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-zinc-800 truncate">
                {user.email}
              </p>
              <p className="text-[10px] text-zinc-400 truncate">Workspace Owner</p>
            </div>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar (hidden on mobile, responsive width) */}
      <aside
        className={`
          hidden lg:block fixed inset-y-0 left-0 z-40 transition-all duration-300 ease-in-out
          ${collapsed ? "w-16" : "w-60"}
        `}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Backdrop & Drawer */}
      {mobileOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 lg:hidden flex"
        >
          {/* Backdrop overlay */}
          <div
            className="fixed inset-0 bg-zinc-900/40 backdrop-blur-xs transition-opacity animate-in fade-in-0 duration-200"
            onClick={onMobileClose}
          />

          {/* Drawer sheet */}
          <div className="relative w-72 max-w-[85vw] h-full shadow-2xl animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
