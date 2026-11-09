import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { notFound } from "next/navigation";
import { Megaphone } from "lucide-react";
import { cachedBreakdown, cachedCampaigns } from "@/lib/cached-analytics";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RankingList } from "@/components/ui/ranking-list";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { buildMetricRequest } from "@/lib/metrics";
import { parseRangeKey, resolveDateRange, type RangeKey } from "@/lib/date-range";
import { RangeSwitcher } from "@/components/range-switcher";
import { RankingCardSkeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { sourceLabel } from "@/lib/channels";
import { ChannelMix } from "@/components/channel-mix";

export default async function SiteAcquisitionReport({
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
    <div className="stagger w-full space-y-5 text-left">
      <PageHeader title="Acquisition" art="ridge" actions={<RangeSwitcher range={range} />}>
        Channels, referrers and campaign links driving traffic to <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>

      <Suspense key={range} fallback={<AcquisitionSkeleton />}>
        <AcquisitionBody workspaceId={workspace.id} siteId={site.id} range={range} />
      </Suspense>
    </div>
  );
}

function AcquisitionSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <RankingCardSkeleton rows={8} />
      <RankingCardSkeleton rows={8} />
    </div>
  );
}

async function AcquisitionBody({ workspaceId, siteId, range }: { workspaceId: string; siteId: string; range: RangeKey }) {
  const { current } = resolveDateRange(range);
  const request = buildMetricRequest(workspaceId, siteId, current, { limit: 20 });

  const [channels, referrers, campaigns] = await Promise.all([
    cachedBreakdown(request, "channel"),
    cachedBreakdown(request, "referrer"),
    cachedCampaigns(request),
  ]);

  const campaignTotal = Math.max(channels.total, campaigns.items.reduce((sum, item) => sum + item.visitors, 0), 1);

  return (
    <div className="space-y-4">
      <ChannelMix items={channels.items} totalVisitors={channels.total} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="reveal">
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
            <div>
              <CardTitle>Top Referring Sources</CardTitle>
              <CardDescription>Websites that sent visitors. Your own pages are not counted as a source</CardDescription>
            </div>
            <span className="font-mono text-xs text-zinc-500 font-medium">
              Visitors · % Share
            </span>
          </CardHeader>
          <div className="pt-2">
            <RankingList
              items={referrers.items.map((item) => ({
                name: sourceLabel(item.name),
                value: item.visitors,
                percentage: item.percentage,
              }))}
              empty="No referrer data recorded in this range yet."
              valueFormatter={formatNumber}
            />
          </div>
        </Card>

        <Card className="reveal">
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
            <div>
              <CardTitle>
                <Megaphone className="h-4 w-4 text-zinc-300 inline-block mr-1" />
                UTM Campaigns
              </CardTitle>
              <CardDescription>Tagged marketing links, newsletters, and social campaigns</CardDescription>
            </div>
            <span className="font-mono text-xs text-zinc-500 font-medium">
              Visitors · % Share
            </span>
          </CardHeader>
          <div className="pt-2">
            <RankingList
              items={campaigns.items.map((utm) => ({
                name: utm.campaign,
                value: utm.visitors,
                percentage: Math.min(100, (utm.visitors / campaignTotal) * 100),
                meta: `${utm.source || "organic"} · ${utm.medium || "web"}`,
              }))}
              empty="No tagged campaign traffic in this range yet."
              valueFormatter={formatNumber}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
