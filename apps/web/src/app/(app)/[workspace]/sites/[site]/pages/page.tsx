import { notFound } from "next/navigation";
import { getBreakdown } from "@trackme/analytics";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { buildMetricRequest } from "@/lib/metrics";
import { parseRangeKey, resolveDateRange } from "@/lib/date-range";
import { formatNumber, formatPercent } from "@/lib/format";

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Pages & Content Report</h1>
        <p className="text-sm text-slate-400">
          Pageview distribution and period-unique visitors by path for {site.domain}.
          Visitor counts use <code className="text-xs">uniqExact</code> over the selected range
          (not summed daily uniques).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Visited Pages</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs uppercase text-slate-400">
              <tr>
                <th className="py-3 px-4">Page Path</th>
                <th className="py-3 px-4 text-right">Pageviews</th>
                <th className="py-3 px-4 text-right">Unique Visitors</th>
                <th className="py-3 px-4 text-right">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {breakdown.items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 px-4 text-center text-slate-500 font-sans">
                    No pageviews recorded in this range yet.
                  </td>
                </tr>
              ) : (
                breakdown.items.map((row) => (
                  <tr key={row.name} className="hover:bg-slate-800/30 transition">
                    <td className="py-3 px-4 text-slate-200">{row.name}</td>
                    <td className="py-3 px-4 text-right font-sans text-slate-200">
                      {formatNumber(row.pageviews)}
                    </td>
                    <td className="py-3 px-4 text-right font-sans text-slate-400">
                      {formatNumber(row.visitors)}
                    </td>
                    <td className="py-3 px-4 text-right font-sans text-emerald-400">
                      {formatPercent(row.percentage)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
