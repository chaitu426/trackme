import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { parseRangeKey } from "@/lib/date-range";
import { RangeSwitcher } from "@/components/range-switcher";
import {
  ChartCardSkeleton,
  MapCardSkeleton,
  RankingCardSkeleton,
  StatsGridSkeleton,
  TableCardSkeleton,
} from "@/components/ui/skeleton";
import {
  FlowSection,
  RouteDetail,
  RoutesList,
  ROUTE_SEPARATOR,
  SegmentTable,
  isJourneySegment,
  type JourneyContext,
} from "./sections";

export default async function UserJourneysPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; site: string }>;
  searchParams: Promise<{ range?: string; segment?: string; route?: string }>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  const { range: rawRange, segment: rawSegment, route: rawRoute } = await searchParams;
  const range = parseRangeKey(rawRange);
  const segment = isJourneySegment(rawSegment) ? rawSegment : "device";
  const route = rawRoute
    ? rawRoute.split(ROUTE_SEPARATOR).map((p) => p.trim()).filter(Boolean).slice(0, 8)
    : null;

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;

  const ctx: JourneyContext = {
    workspaceId: workspace.id,
    siteId: site.id,
    basePath: `/${workspace.slug}/sites/${site.domain}/journeys`,
    range,
    segment,
    route: route && route.length > 0 ? route : null,
  };
  const routeKey = ctx.route?.join(ROUTE_SEPARATOR) ?? "";
  const extraQuery = `&segment=${segment}${routeKey ? `&route=${encodeURIComponent(routeKey)}` : ""}`;

  return (
    <div className="stagger w-full space-y-5 text-left">
      <PageHeader title="User Journeys" art="stream" actions={<RangeSwitcher range={range} extraQuery={extraQuery} />}>
        Follow visitors page by page through <span className="font-mono text-zinc-300">{site.domain}</span>: where they start, where they go and where they leave
      </PageHeader>

      <Suspense
        key={`flow:${range}`}
        fallback={
          <div className="space-y-5">
            <StatsGridSkeleton count={4} />
            <MapCardSkeleton height={420} />
          </div>
        }
      >
        <FlowSection {...ctx} />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Suspense key={`routes:${range}`} fallback={<RankingCardSkeleton rows={8} />}>
          <RoutesList {...ctx} />
        </Suspense>
        <Suspense key={`detail:${range}:${routeKey}`} fallback={<ChartCardSkeleton height={300} />}>
          <RouteDetail {...ctx} />
        </Suspense>
      </div>

      <Suspense key={`seg:${range}:${segment}`} fallback={<TableCardSkeleton rows={4} cols={6} />}>
        <SegmentTable {...ctx} />
      </Suspense>
    </div>
  );
}
