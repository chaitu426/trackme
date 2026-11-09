import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { notFound } from "next/navigation";
import { cachedBreakdown, cachedOverview, cachedPageEngagement } from "@/lib/cached-analytics";
import type { PageEngagementRow } from "@trackme/analytics";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RankingList } from "@/components/ui/ranking-list";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { buildMetricRequest } from "@/lib/metrics";
import { parseRangeKey, resolveDateRange, type RangeKey } from "@/lib/date-range";
import { RangeSwitcher } from "@/components/range-switcher";
import { RankingCardSkeleton } from "@/components/ui/skeleton";
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

  return (
    <div className="stagger w-full space-y-5 text-left">
      <PageHeader title="Page Performance" art="ridge" actions={<RangeSwitcher range={range} />}>
        How each page performs: views, time spent, bounces and exits on <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>

      <Suspense key={range} fallback={<RankingCardSkeleton rows={12} />}>
        <PagesBody workspaceId={workspace.id} siteId={site.id} range={range} />
      </Suspense>
    </div>
  );
}

const PAGE_LIMIT = 50;

async function PagesBody({ workspaceId, siteId, range }: { workspaceId: string; siteId: string; range: RangeKey }) {
  const { current } = resolveDateRange(range);
  const request = buildMetricRequest(workspaceId, siteId, current, { limit: 100 });

  // Engagement needs session-level data. If that query is unavailable the page still shows volume.
  let rows: PageEngagementRow[] | null = null;
  try {
    rows = await cachedPageEngagement(request, PAGE_LIMIT);
  } catch {
    rows = null;
  }
  if (rows) return <EngagementTable rows={rows} />;

  const [breakdown, overview] = await Promise.all([cachedBreakdown(request, "path"), cachedOverview(request)]);
  // The breakdown's own percentage is a share of visitors; this list ranks by pageviews.
  const totalPageviews = Math.max(overview.pageviews, 1);
  return (
    <Card className="reveal">
      <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
        <div>
          <CardTitle>All Visited Routes</CardTitle>
          <CardDescription>Engagement details are unavailable right now; showing volume only</CardDescription>
        </div>
        <span className="font-mono text-xs text-zinc-500 font-medium">Pageviews · % Share</span>
      </CardHeader>
      <div className="pt-2">
        <RankingList
          items={breakdown.items.map((row) => ({
            name: row.name,
            value: row.pageviews,
            percentage: Math.min(100, (row.pageviews / totalPageviews) * 100),
            meta: `${formatNumber(row.visitors)} visitors`,
          }))}
          empty="No pageviews recorded in this date range yet."
          valueFormatter={formatNumber}
        />
      </div>
    </Card>
  );
}

function seconds(value: number | null): string {
  if (value === null) return "–";
  if (value < 60) return `${value.toFixed(value < 10 ? 1 : 0)}s`;
  return `${Math.floor(value / 60)}m ${String(Math.round(value % 60)).padStart(2, "0")}s`;
}

/** Bounce above 70% on a page people land on, or exit above 60%, is worth a look. */
const tone = (value: number | null, warn: number) =>
  value !== null && value >= warn ? "text-[#e5484d]" : "text-zinc-300";

function EngagementTable({ rows }: { rows: PageEngagementRow[] }) {
  const totalViews = Math.max(rows.reduce((sum, r) => sum + r.pageviews, 0), 1);
  return (
    <Card className="reveal">
      <CardHeader className="border-b border-white/[0.06] pb-3 text-left">
        <CardTitle>All Visited Routes</CardTitle>
        <CardDescription>
          Top {rows.length} pages by views. Time on page counts only the time a page was visible and in use. Bounce is
          measured on sessions that started on the page; exit is the share of its views that ended a session.
        </CardDescription>
      </CardHeader>
      {rows.length === 0 ? (
        <p className="py-12 text-center text-xs text-zinc-500">No pageviews recorded in this date range yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] text-zinc-500">
                <th className="px-4 py-3 font-medium">Page</th>
                <th className="px-3 py-3 text-right font-medium">Views</th>
                <th className="px-3 py-3 text-right font-medium">Visitors</th>
                <th className="px-3 py-3 text-right font-medium">Time on page</th>
                <th className="px-3 py-3 text-right font-medium">Entrances</th>
                <th className="px-3 py-3 text-right font-medium">Bounce</th>
                <th className="px-4 py-3 text-right font-medium">Exit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] font-mono tabular-nums">
              {rows.map((r) => (
                <tr key={r.path} className="transition-colors hover:bg-white/[0.03]">
                  <td className="max-w-[320px] px-4 py-2.5">
                    <div className="truncate font-sans text-[13px] font-medium text-zinc-200" title={r.path}>
                      {r.path}
                    </div>
                    <div className="mt-1.5 h-[3px] w-full rounded-full bg-white/[0.05]">
                      <div className="h-full rounded-full bg-zinc-300/60" style={{ width: `${Math.max((r.pageviews / totalViews) * 100, 1.5)}%` }} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-zinc-100">{formatNumber(r.pageviews)}</td>
                  <td className="px-3 py-2.5 text-right text-zinc-400">{formatNumber(r.visitors)}</td>
                  <td className="px-3 py-2.5 text-right text-zinc-300">{seconds(r.avgActiveSeconds)}</td>
                  <td className="px-3 py-2.5 text-right text-zinc-400">{r.entrances > 0 ? formatNumber(r.entrances) : "–"}</td>
                  <td className={`px-3 py-2.5 text-right ${tone(r.bounceRate, 70)}`}>
                    {r.bounceRate === null ? "–" : formatPercent(r.bounceRate)}
                  </td>
                  <td className={`px-4 py-2.5 text-right ${tone(r.exitRate, 60)}`}>
                    {r.exitRate === null ? "–" : formatPercent(r.exitRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
