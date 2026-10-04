import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Globe2, Megaphone } from "lucide-react";
import { getBreakdown, getCampaignBreakdown } from "@trackme/analytics";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RankingList } from "@/components/ui/ranking-list";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { buildMetricRequest } from "@/lib/metrics";
import { parseRangeKey, resolveDateRange, RANGE_OPTIONS } from "@/lib/date-range";
import { formatNumber } from "@/lib/format";

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

  const { current } = resolveDateRange(range);
  const request = buildMetricRequest(workspace.id, site.id, current, { limit: 20 });

  const [referrers, campaigns] = await Promise.all([
    getBreakdown(request, "referrer"),
    getCampaignBreakdown(request),
  ]);

  const campaignMax = Math.max(...campaigns.items.map((item) => item.visitors), 1);

  return (
    <div className="w-full space-y-5 text-left">
      {/* Top Header: Strictly Left-Anchored */}
      <div className="flex flex-col justify-between gap-4 border-b border-white/[0.06] pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-50">Acquisition &amp; Sources</h1>
          <p className="mt-1 text-xs text-zinc-400">
            Discovery channels, referrers, and campaign links driving traffic to{" "}
            <span className="font-mono font-medium text-zinc-300">{site.domain}</span>
          </p>
        </div>

        {/* Range switcher pills */}
        <div className="flex items-center rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5 text-xs font-medium text-zinc-400 gap-0.5">
          {RANGE_OPTIONS.map((option) => (
            <Link
              key={option.key}
              href={`?range=${option.key}`}
              className={`rounded-[5px] px-3 py-1.5 transition-colors font-medium ${
                option.key === range
                  ? "bg-zinc-800 text-zinc-100 shadow-sm"
                  : "hover:bg-white/[0.04] hover:text-zinc-300 text-zinc-500"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
            <div>
              <CardTitle>Top Referring Sources</CardTitle>
              <CardDescription>Inbound discovery sources and referral domains</CardDescription>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Visitors · % Share
            </span>
          </CardHeader>
          <div className="pt-2">
            <RankingList
              items={referrers.items.map((item) => ({
                name: item.name || "Direct / None",
                value: item.visitors,
                percentage: item.percentage,
                icon: <Globe2 className="h-3.5 w-3.5 text-blue-400" />,
              }))}
              empty="No referrer data recorded in this range yet."
              valueFormatter={formatNumber}
            />
          </div>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
            <div>
              <CardTitle>
                <Megaphone className="h-4 w-4 text-purple-400 inline-block mr-1" />
                UTM Campaigns
              </CardTitle>
              <CardDescription>Tagged marketing links, newsletters, and social campaigns</CardDescription>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Visitors · % Share
            </span>
          </CardHeader>
          <div className="pt-2">
            <RankingList
              items={campaigns.items.map((utm) => ({
                name: utm.campaign,
                value: utm.visitors,
                percentage: (utm.visitors / campaignMax) * 100,
                meta: `${utm.source || "organic"} · ${utm.medium || "web"}`,
                icon: <FileText className="h-3.5 w-3.5 text-purple-400" />,
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
