import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { getBreakdown } from "@trackme/analytics";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RankingList } from "@/components/ui/ranking-list";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { buildMetricRequest } from "@/lib/metrics";
import { parseRangeKey, resolveDateRange, RANGE_OPTIONS } from "@/lib/date-range";
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

  const { current } = resolveDateRange(range);
  const request = buildMetricRequest(workspace.id, site.id, current, { limit: 100 });
  const breakdown = await getBreakdown(request, "path");

  return (
    <div className="w-full space-y-5 text-left">
      {/* Top Header: Strictly Left-Anchored */}
      <div className="flex flex-col justify-between gap-4 border-b border-white/[0.06] pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-50">Page Performance</h1>
          <p className="mt-1 text-xs text-zinc-400">
            Pageview volume and engagement metrics for{" "}
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

      <Card>
        <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
          <div>
            <CardTitle>All Visited Routes</CardTitle>
            <CardDescription>
              Ranked distribution of pageview volume and audience share ({breakdown.items.length} routes recorded)
            </CardDescription>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
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
              icon: <FileText className="h-3.5 w-3.5 text-blue-400" />,
            }))}
            empty="No pageviews recorded in this date range yet."
            valueFormatter={formatNumber}
          />
        </div>
      </Card>
    </div>
  );
}
