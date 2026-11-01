import { Card } from "@/components/ui/card";
import {
  CardHeaderSkeleton,
  ChartCardSkeleton,
  MapCardSkeleton,
  PageHeaderSkeleton,
  RankingCardSkeleton,
  Skeleton,
  SkeletonRegion,
  StatsGridSkeleton,
  TableCardSkeleton,
} from "@/components/ui/skeleton";

/**
 * Whole-page placeholders used by each route's loading.tsx. They mirror the real
 * page's layout block for block, so the swap to real content does not shift anything.
 */
function Page({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <SkeletonRegion label={label} className="w-full space-y-5 text-left">
      {children}
    </SkeletonRegion>
  );
}

export function OverviewPageSkeleton() {
  return (
    <Page label="Loading overview">
      <PageHeaderSkeleton />
      <StatsGridSkeleton count={8} />
      <ChartCardSkeleton />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RankingCardSkeleton />
        <RankingCardSkeleton />
      </div>
    </Page>
  );
}

export function RankingPageSkeleton({ twoUp = false }: { twoUp?: boolean }) {
  return (
    <Page label="Loading report">
      <PageHeaderSkeleton />
      {twoUp ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RankingCardSkeleton rows={8} />
          <RankingCardSkeleton rows={8} />
        </div>
      ) : (
        <RankingCardSkeleton rows={12} />
      )}
    </Page>
  );
}

export function GeographyPageSkeleton() {
  return (
    <Page label="Loading geography">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.85fr)]">
        <MapCardSkeleton />
        <RankingCardSkeleton rows={8} />
      </div>
      <StatsGridSkeleton count={3} className="grid grid-cols-1 gap-4 sm:grid-cols-3" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RankingCardSkeleton rows={6} />
        <RankingCardSkeleton rows={6} />
      </div>
    </Page>
  );
}

export function VitalsPageSkeleton() {
  return (
    <Page label="Loading web vitals">
      <PageHeaderSkeleton />
      <Skeleton className="h-[74px] w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Card key={i}>
            <CardHeaderSkeleton />
            <div className="space-y-4 pt-3">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-2 w-full rounded-full" />
              <Skeleton className="h-3 w-full" />
            </div>
          </Card>
        ))}
      </div>
    </Page>
  );
}

export function EventsPageSkeleton() {
  return (
    <Page label="Loading goals and events">
      <PageHeaderSkeleton />
      <TableCardSkeleton rows={4} cols={4} />
      <TableCardSkeleton rows={6} cols={5} />
    </Page>
  );
}

export function TablePageSkeleton({ stats = 0 }: { stats?: number }) {
  return (
    <Page label="Loading">
      <PageHeaderSkeleton />
      {stats > 0 && <StatsGridSkeleton count={stats} className="grid grid-cols-2 gap-1 lg:grid-cols-4" />}
      <TableCardSkeleton rows={10} cols={5} />
    </Page>
  );
}

export function FunnelsPageSkeleton() {
  return (
    <Page label="Loading funnels">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card>
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        </Card>
        <Card>
          <CardHeaderSkeleton />
          <div className="space-y-3 pt-4">
            {[100, 72, 48, 31].map((w) => (
              <Skeleton key={w} className="h-12 rounded-lg" style={{ width: `${w}%` }} />
            ))}
          </div>
        </Card>
      </div>
    </Page>
  );
}

export function RealtimePageSkeleton() {
  return (
    <Page label="Loading realtime">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i} className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-20" />
          </Card>
        ))}
      </div>
      <TableCardSkeleton rows={10} cols={3} />
    </Page>
  );
}

export function JourneysPageSkeleton() {
  return (
    <Page label="Loading journeys">
      <PageHeaderSkeleton />
      <StatsGridSkeleton count={4} />
      <MapCardSkeleton height={420} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <RankingCardSkeleton rows={8} />
        <ChartCardSkeleton height={300} />
      </div>
    </Page>
  );
}

export function SettingsPageSkeleton() {
  return (
    <Page label="Loading settings">
      <PageHeaderSkeleton controls={false} />
      {Array.from({ length: 3 }, (_, i) => (
        <Card key={i} className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-2/3 rounded-lg" />
        </Card>
      ))}
    </Page>
  );
}
