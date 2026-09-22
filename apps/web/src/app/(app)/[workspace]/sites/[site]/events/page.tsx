import Link from "next/link";
import { notFound } from "next/navigation";
import { db, goals, eq, desc } from "@trackme/db";
import {
  getCustomEventsSummary,
  getGoalMetrics,
  type CustomEventSummary,
} from "@trackme/analytics";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { buildMetricRequest } from "@/lib/metrics";
import { RANGE_OPTIONS, parseRangeKey, resolveDateRange } from "@/lib/date-range";
import { formatRelativeTime } from "@/lib/format";
import { GoalsManager } from "./goals-manager";

export default async function SiteEventsAndGoalsPage({
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
  const request = buildMetricRequest(workspace.id, site.id, current);

  // Fetch defined goals from DB
  const rawGoals = await db
    .select()
    .from(goals)
    .where(eq(goals.siteId, site.id))
    .orderBy(desc(goals.createdAt));

  // Compute conversion metrics against ClickHouse
  const [goalMetrics, customEvents] = await Promise.all([
    getGoalMetrics(
      workspace.id,
      site.id,
      rawGoals.map((g) => ({
        id: g.id,
        name: g.name,
        type: g.type,
        eventName: g.eventName,
        pathPattern: g.pathPattern,
        targetValue: g.targetValue,
        enabled: g.enabled,
      })),
      current
    ),
    getCustomEventsSummary(request),
  ]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Events & Conversion Goals</h1>
          <p className="text-sm text-slate-400">
            Track user behavior actions, custom event triggers, and funnel conversion rates for {site.domain}
          </p>
        </div>

        <div className="flex items-center space-x-1 bg-[#11131a] border border-slate-800 rounded-lg p-1 text-xs font-semibold">
          {RANGE_OPTIONS.map((option) => (
            <Link
              key={option.key}
              href={`?range=${option.key}`}
              className={`px-3 py-1.5 rounded-md transition ${
                option.key === range
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Conversion Goals Section */}
      <GoalsManager siteId={site.id} initialGoals={goalMetrics} />

      {/* Custom Events Explorer */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Tracked Custom Events</CardTitle>
              <CardDescription>
                Custom business events emitted from your frontend application via the SDK.
              </CardDescription>
            </div>
            <Badge variant="outline">
              {customEvents.length} {customEvents.length === 1 ? "Event Type" : "Event Types"}
            </Badge>
          </div>
        </CardHeader>

        <div className="space-y-4">
          {customEvents.length === 0 ? (
            <div className="p-6 rounded-xl bg-[#090a0f] border border-dashed border-slate-800 text-center space-y-2">
              <p className="text-sm text-slate-300 font-medium">No custom events recorded yet</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Trigger events in your app using the tracker snippet. For example:
              </p>
              <pre className="font-mono text-xs bg-[#141824] p-3 rounded-lg border border-slate-800 text-slate-300 max-w-md mx-auto text-left">
                {`window.growth.trackEvent('button_clicked', { plan: 'pro' });`}
              </pre>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                    <th className="pb-3 font-semibold">Event Name</th>
                    <th className="pb-3 font-semibold text-right">Total Triggers</th>
                    <th className="pb-3 font-semibold text-right">Unique Sessions</th>
                    <th className="pb-3 font-semibold text-right">Unique Visitors</th>
                    <th className="pb-3 font-semibold text-right">Last Triggered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {customEvents.map((evt: CustomEventSummary) => (
                    <tr key={evt.eventName} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 font-bold text-white flex items-center space-x-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                        <span>{evt.eventName}</span>
                      </td>
                      <td className="py-3 text-right text-slate-200">
                        {evt.count.toLocaleString()}
                      </td>
                      <td className="py-3 text-right text-slate-400">
                        {evt.uniqueSessions.toLocaleString()}
                      </td>
                      <td className="py-3 text-right text-slate-400">
                        {evt.uniqueVisitors.toLocaleString()}
                      </td>
                      <td className="py-3 text-right text-slate-500 font-sans text-[11px]">
                        {formatRelativeTime(evt.lastSeen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Quick SDK helper */}
          <div className="p-3 rounded-lg bg-[#0c0e15] border border-slate-800/60 text-xs text-slate-400 flex items-center justify-between">
            <span>
              Emit custom events anytime in client JavaScript:
            </span>
            <code className="text-slate-300 font-mono text-[11px] bg-[#141824] px-2 py-1 rounded border border-slate-800">
              window.growth.trackEvent(&apos;event_name&apos;, &#123; prop: &apos;val&apos; &#125;)
            </code>
          </div>
        </div>
      </Card>
    </div>
  );
}
