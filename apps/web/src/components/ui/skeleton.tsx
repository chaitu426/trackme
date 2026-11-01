import type { CSSProperties } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Base shimmer block. Size it with className (h-*, w-*). Decorative, so hidden from assistive tech. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={cn("skeleton", className)} style={style} />;
}

/** Wraps a skeleton region so screen readers announce loading once instead of per block. */
export function SkeletonRegion({ label = "Loading", className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function PageHeaderSkeleton({ controls = true }: { controls?: boolean }) {
  return (
    <div className="flex flex-col justify-between gap-4 border-b border-white/[0.06] pb-4 sm:flex-row sm:items-center">
      <div className="space-y-2">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-3 w-72 max-w-full" />
      </div>
      {controls && (
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-32 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
      )}
    </div>
  );
}

/** Matches StatsCard's footprint (label, figure, change) so the grid does not shift when data arrives. */
export function StatsCardSkeleton() {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-4 w-36" />
    </Card>
  );
}

export function StatsGridSkeleton({ count = 4, className = "grid grid-cols-2 gap-4 lg:grid-cols-4" }: { count?: number; className?: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <StatsCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function CardHeaderSkeleton() {
  return (
    <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3">
      <div className="space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
      <Skeleton className="h-3 w-20" />
    </CardHeader>
  );
}

const ROW_WIDTHS = ["88%", "72%", "64%", "52%", "44%", "38%", "30%", "24%"];

export function RankingListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-1 pt-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3" style={{ width: ROW_WIDTHS[i % ROW_WIDTHS.length] ?? "50%" }} />
            <Skeleton className="h-1 w-full" />
          </div>
          <Skeleton className="h-3 w-10 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function RankingCardSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card>
      <CardHeaderSkeleton />
      <RankingListSkeleton rows={rows} />
    </Card>
  );
}

const BAR_HEIGHTS = [38, 55, 42, 68, 50, 76, 60, 84, 58, 72, 48, 64, 80, 52, 70, 44, 66, 56, 78, 46];

export function ChartCardSkeleton({ height = 260 }: { height?: number }) {
  return (
    <Card className="overflow-hidden">
      <CardHeaderSkeleton />
      <div className="flex items-end gap-2 px-2 pt-6" style={{ height }}>
        {BAR_HEIGHTS.map((h, i) => (
          <Skeleton key={i} className="flex-1 rounded-t-md rounded-b-none" style={{ height: `${h}%` }} />
        ))}
      </div>
    </Card>
  );
}

export function MapCardSkeleton({ height = 320 }: { height?: number }) {
  return (
    <Card>
      <CardHeaderSkeleton />
      <div className="pt-3">
        <Skeleton className="w-full rounded-lg" style={{ height }} />
      </div>
    </Card>
  );
}

export function TableSkeleton({ rows = 8, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-1 pt-2">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 px-3 py-3">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cn("h-3", c === 0 ? "w-1/3" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function TableCardSkeleton({ rows = 8, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <Card>
      <CardHeaderSkeleton />
      <TableSkeleton rows={rows} cols={cols} />
    </Card>
  );
}
