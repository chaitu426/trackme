import { MetricsMethodology } from "@/components/metrics-methodology";
import { PageHeader } from "@/components/ui/page-header";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { requirePrimarySite } from "@/lib/tenancy";
import { parseRangeKey } from "@/lib/date-range";
import { Skeleton, StatsGridSkeleton, ChartCardSkeleton, MapCardSkeleton, RankingCardSkeleton } from "@/components/ui/skeleton";
import type { DimensionFilter } from "@trackme/contracts";
import {
  ActiveVisitorsBadge,
  DevicesSection,
  KpiGrid,
  LocationsSection,
  OverviewFilterBar,
  SecondaryMetrics,
  TopJourneys,
  TopPages,
  TopSources,
  TrafficChart,
  type SectionProps,
} from "./sections";

export default async function OverviewDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ range?: string; country?: string; device?: string }>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug } = await params;
  const { range: rawRange, country: rawCountry, device: rawDevice } = await searchParams;
  const range = parseRangeKey(rawRange);
  const country = /^[A-Z]{2}$/.test(rawCountry ?? "") ? rawCountry : undefined;
  const device: "desktop" | "mobile" | "tablet" | undefined =
    rawDevice === "desktop" || rawDevice === "mobile" || rawDevice === "tablet" ? rawDevice : undefined;

  const filters: DimensionFilter | undefined = (() => {
    const next: DimensionFilter = {};
    if (country) next.country = country;
    if (device) next.device = device;
    return Object.keys(next).length > 0 ? next : undefined;
  })();

  let context: Awaited<ReturnType<typeof requirePrimarySite>>;
  try {
    context = await requirePrimarySite(user.id, workspaceSlug);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "NO_SITES") {
      redirect(`/${workspaceSlug}/settings/sites`);
    }
    notFound();
  }
  const { workspace, site } = context;

  const section: SectionProps = {
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    siteId: site.id,
    domain: site.domain,
    range,
    filters,
  };
  // Changing the range or a filter swaps the skeletons back in instead of freezing the old numbers.
  const dataKey = `${range}:${country ?? ""}:${device ?? ""}`;

  return (
    <div className="w-full space-y-6 text-left">
      <PageHeader
        title="Overview"
        art="ridge"
        actions={
          <>
            <Suspense
              key={`filters:${dataKey}`}
              fallback={
                <div className="flex items-center gap-2">
                  <Skeleton className="h-8 w-[120px] rounded-lg" />
                  <Skeleton className="h-8 w-24 rounded-lg" />
                  <Skeleton className="h-8 w-24 rounded-lg" />
                </div>
              }
            >
              <OverviewFilterBar {...section} />
            </Suspense>
            <Suspense fallback={<Skeleton className="h-8 w-28 rounded-lg" />}>
              <ActiveVisitorsBadge siteId={site.id} />
            </Suspense>
          </>
        }
      >
        <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>

      <Suspense key={`kpi:${dataKey}`} fallback={<StatsGridSkeleton count={4} />}>
        <KpiGrid {...section} />
      </Suspense>

      <Suspense key={`chart:${dataKey}`} fallback={<ChartCardSkeleton />}>
        <TrafficChart {...section} />
      </Suspense>

      <Suspense key={`more:${dataKey}`} fallback={<StatsGridSkeleton count={4} />}>
        <SecondaryMetrics {...section} />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Suspense key={`sources:${dataKey}`} fallback={<RankingCardSkeleton />}>
          <TopSources {...section} />
        </Suspense>
        <Suspense key={`pages:${dataKey}`} fallback={<RankingCardSkeleton />}>
          <TopPages {...section} />
        </Suspense>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Suspense key={`locations:${dataKey}`} fallback={<MapCardSkeleton height={380} />}>
          <LocationsSection {...section} />
        </Suspense>
        <Suspense key={`devices:${dataKey}`} fallback={<RankingCardSkeleton rows={6} />}>
          <DevicesSection {...section} />
        </Suspense>
      </div>

      <Suspense key={`journeys:${dataKey}`} fallback={<RankingCardSkeleton rows={4} />}>
        <TopJourneys {...section} />
      </Suspense>

      <MetricsMethodology />
    </div>
  );
}
