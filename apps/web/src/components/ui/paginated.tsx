"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Shows `pageSize` children at a time with a small pager underneath. The rows are rendered
 * on the server and passed in, so this works for lists whose rows hold functions or icons.
 * The pager only appears when there is more than one page. Rank numbers inside the rows
 * stay global because the rows are built before they are paged.
 */
export function Paginated({
  children,
  pageSize = 10,
  className = "",
}: {
  children: React.ReactNode;
  pageSize?: number;
  className?: string;
}) {
  const rows = React.Children.toArray(children);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const [page, setPage] = React.useState(0);
  const current = Math.min(page, pages - 1);
  const start = current * pageSize;

  return (
    <div>
      <div className={className}>{rows.slice(start, start + pageSize)}</div>
      {pages > 1 && (
        <div className="mt-2 flex items-center justify-between border-t border-white/[0.05] px-1 pt-2 text-xs text-zinc-500">
          <span className="font-mono tabular-nums">
            {start + 1}–{Math.min(start + pageSize, rows.length)} of {rows.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(current - 1)}
              disabled={current === 0}
              aria-label="Previous page"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.08] text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[44px] text-center font-mono tabular-nums">
              {current + 1} / {pages}
            </span>
            <button
              type="button"
              onClick={() => setPage(current + 1)}
              disabled={current >= pages - 1}
              aria-label="Next page"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.08] text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
