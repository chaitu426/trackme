import { notFound } from "next/navigation";
import { getBreakdown, getCampaignBreakdown } from "@trackme/analytics";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { buildMetricRequest } from "@/lib/metrics";
import { parseRangeKey, resolveDateRange } from "@/lib/date-range";
import { formatNumber, formatPercent } from "@/lib/format";

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
  const request = buildMetricRequest(workspace.id, site.id, current, { limit: 10 });

  const [referrers, campaigns] = await Promise.all([
    getBreakdown(request, "referrer"),
    getCampaignBreakdown(request),
  ]);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          Acquisition & Channels
        </h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Source, medium, UTM campaigns, and referring sites driving traffic to{" "}
          <span className="font-mono font-semibold text-zinc-700">{site.domain}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Referring Channels */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Top Referring Channels</CardTitle>
          </CardHeader>
          <div className="space-y-1">
            {referrers.items.length === 0 ? (
              <p className="text-xs text-zinc-400 py-4 text-center">No referrer data in this range yet.</p>
            ) : (
              referrers.items.map((item) => (
                <div
                  key={item.name}
                  className="flex justify-between items-center py-2.5 border-b border-zinc-100 last:border-0"
                >
                  <span className="text-xs text-zinc-700 font-medium">{item.name || "direct"}</span>
                  <div className="flex items-center space-x-2.5">
                    <span className="text-xs font-bold text-zinc-900 font-mono">{formatNumber(item.visitors)}</span>
                    <Badge variant="outline" className="font-mono text-[11px]">{formatPercent(item.percentage)}</Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* UTM Campaigns */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>UTM Campaign Attribution</CardTitle>
          </CardHeader>
          <div className="space-y-2.5">
            {campaigns.items.length === 0 ? (
              <p className="text-xs text-zinc-400 py-4 text-center">No tagged campaign traffic in this range yet.</p>
            ) : (
              campaigns.items.map((utm) => (
                <div
                  key={`${utm.campaign}-${utm.source}-${utm.medium}`}
                  className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200/80 text-xs space-y-1.5"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-mono font-semibold text-indigo-700">{utm.campaign}</span>
                    <span className="font-bold text-zinc-900 font-mono">{formatNumber(utm.visitors)} visitors</span>
                  </div>
                  <div className="text-zinc-500 font-mono text-[11px] space-x-2">
                    <span>source: <span className="text-zinc-700">{utm.source || "—"}</span></span>
                    <span>·</span>
                    <span>medium: <span className="text-zinc-700">{utm.medium || "—"}</span></span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
