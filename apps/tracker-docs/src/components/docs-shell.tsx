"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronRight, Menu, ShieldCheck } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { SearchDialog, SearchTrigger } from "@/components/search-dialog";
import { SetupMenu } from "@/components/setup-menu";
import { OnThisPage } from "@/components/toc";
import { groupOf, neighbours, pageOf } from "@/lib/nav";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "trackme_docs_sidebar_collapsed";

export function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLLAPSE_KEY);
      if (saved !== null) setCollapsed(saved === "true");
    } catch {
      // Not remembering the layout is harmless.
    }
  }, []);

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      } else if (event.key === "/" && !typing) {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleCollapse = () => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const closeMobile = React.useCallback(() => setMobileOpen(false), []);
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const page = pageOf(normalized);
  const group = groupOf(normalized);
  const { prev, next } = neighbours(normalized);

  return (
    <div className="relative flex min-h-screen flex-col bg-background antialiased">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onMobileClose={closeMobile}
      />

      <div className={cn("flex flex-1 flex-col transition-all duration-300 ease-in-out", collapsed ? "lg:ml-16" : "lg:ml-64")}>
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b border-white/[0.06] bg-background/80 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/10 text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-xs text-zinc-500 md:flex">
              <Link href="/docs" className="no-underline-link transition hover:text-zinc-200">
                Docs
              </Link>
              {group && (
                <>
                  <ChevronRight className="h-3 w-3 shrink-0 text-zinc-700" />
                  <span className="truncate">{group}</span>
                </>
              )}
              {page && normalized !== "/docs" && (
                <>
                  <ChevronRight className="h-3 w-3 shrink-0 text-zinc-700" />
                  <span className="truncate text-zinc-300">{page.title}</span>
                </>
              )}
            </nav>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2.5">
            <SearchTrigger onOpen={() => setSearchOpen(true)} />
            <SetupMenu />
            <div className="hidden items-center gap-1.5 rounded-md border border-emerald-500/15 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-400 xl:flex">
              <ShieldCheck className="h-3 w-3" strokeWidth={2.4} />
              Cookieless · Privacy-safe
            </div>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-[1200px] flex-1 gap-10 px-4 py-8 sm:px-6 lg:px-10">
          <main className="min-w-0 flex-1 animate-fade-in-up">
            {children}

            {(prev || next) && (
              <nav aria-label="Pagination" className="mt-14 grid gap-3 border-t border-white/[0.06] pt-6 sm:grid-cols-2">
                {prev ? (
                  <Link href={prev.href} className="linear-card no-underline-link group flex flex-col gap-1 p-4">
                    <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <ArrowLeft className="h-3 w-3" /> Previous
                    </span>
                    <span className="text-[13px] font-medium text-zinc-100">{prev.title}</span>
                  </Link>
                ) : (
                  <span />
                )}
                {next && (
                  <Link href={next.href} className="linear-card no-underline-link group flex flex-col items-end gap-1 p-4 text-right">
                    <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                      Next <ArrowRight className="h-3 w-3" />
                    </span>
                    <span className="text-[13px] font-medium text-zinc-100">{next.title}</span>
                  </Link>
                )}
              </nav>
            )}
          </main>

          <aside className="sticky top-20 hidden h-fit max-h-[calc(100vh-6rem)] w-52 shrink-0 overflow-y-auto xl:block">
            <OnThisPage />
          </aside>
        </div>
      </div>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
