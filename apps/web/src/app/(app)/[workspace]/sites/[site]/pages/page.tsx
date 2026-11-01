import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { notFound } from "next/navigation";
import { cachedBreakdown } from "@/lib/cached-analytics";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RankingList } from "@/components/ui/ranking-list";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { buildMetricRequest } from "@/lib/metrics";
import { parseRangeKey, resolveDateRange, type RangeKey } from "@/lib/date-range";
import { RangeSwitcher } from "@/components/range-switcher";
import { RankingCardSkeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";

export default async function SitePagesReport({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; site: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  const { range: rawRange } = await searchParams;
  const range = parseRangeKey(rawRange);

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;

  return (
    <div className="w-full space-y-5 text-left">
      <PageHeader title="Page Performance" art="ridge" actions={<RangeSwitcher range={range} />}>
        Pageview volume and engagement for <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>

      <Suspense key={range} fallback={<RankingCardSkeleton rows={12} />}>
        <PagesBody workspaceId={workspace.id} siteId={site.id} range={range} />
      </Suspense>
    </div>
  );
}

async function PagesBody({ workspaceId, siteId, range }: { workspaceId: string; siteId: string; range: RangeKey }) {
  const { current } = resolveDateRange(range);
  const request = buildMetricRequest(workspaceId, siteId, current, { limit: 100 });
  const breakdown = await cachedBreakdown(request, "path");

  return (
      <Card className="reveal">
        <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
          <div>
            <CardTitle>All Visited Routes</CardTitle>
            <CardDescription>
              Ranked distribution of pageview volume and audience share ({breakdown.items.length} routes recorded)
            </CardDescription>
          </div>
          <span className="font-mono text-xs text-zinc-500 font-medium">
            Pageviews · % Share
          </span>
        </CardHeader>
        <div className="pt-2">
          <RankingList
            items={breakdown.items.map((row) => ({
              name: row.name,
              value: row.pageviews,
              percentage: row.percentage,
              meta: `${formatNumber(row.visitors)} unique visitors`,
            }))}
            empty="No pageviews recorded in this date range yet."
            valueFormatter={formatNumber}
          />
        </div>
      </Card>
  );
}
