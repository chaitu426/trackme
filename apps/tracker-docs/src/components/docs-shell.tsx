"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronRight, Menu } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { SearchDialog, SearchTrigger } from "@/components/search-dialog";
import { SetupMenu } from "@/components/setup-menu";
import { DocsFooter } from "@/components/docs-footer";
import { Spot } from "@trackme/landing";
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
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-white/[0.08] bg-background px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.1] text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100 lg:hidden"
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
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-[1200px] flex-1 gap-10 px-4 py-10 sm:px-6 lg:px-10">
          <main className="min-w-0 flex-1 animate-fade-in-up">
            {children}

            {(prev || next) && (
              <nav aria-label="Pagination" className="mt-16 grid gap-4 border-t border-white/[0.08] pt-8 sm:grid-cols-2">
                {prev ? (
                  <Spot className="rounded-xl">
                    <Link href={prev.href} className="no-underline-link group flex flex-col gap-1.5 rounded-xl border border-white/[0.08] bg-[#19191b] p-4 transition-colors duration-150 hover:border-white/[0.14]">
                      <span className="flex items-center gap-1.5 font-mono text-xs text-zinc-500">
                        <ArrowLeft className="h-4 w-4" /> Previous
                      </span>
                      <span className="text-sm font-medium text-zinc-100">{prev.title}</span>
                    </Link>
                  </Spot>
                ) : (
                  <span />
                )}
                {next && (
                  <Spot className="rounded-xl">
                    <Link href={next.href} className="no-underline-link group flex flex-col items-end gap-1.5 rounded-xl border border-white/[0.08] bg-[#19191b] p-4 text-right transition-colors duration-150 hover:border-white/[0.14]">
                      <span className="flex items-center gap-1.5 font-mono text-xs text-zinc-500">
                        Next <ArrowRight className="h-4 w-4" />
                      </span>
                      <span className="text-sm font-medium text-zinc-100">{next.title}</span>
                    </Link>
                  </Spot>
                )}
              </nav>
            )}
          </main>

          <aside className="sticky top-24 hidden h-fit max-h-[calc(100vh-6rem)] w-52 shrink-0 overflow-y-auto xl:block">
            <OnThisPage />
          </aside>
        </div>
        <DocsFooter />
      </div>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
