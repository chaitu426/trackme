import Link from "next/link";
import { notFound } from "next/navigation";
import { Target, Zap } from "lucide-react";
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
    <div className="w-full space-y-5 text-left">
      {/* ── Top Header: Strictly Left-Anchored ── */}
      <div className="flex flex-col justify-between gap-4 border-b border-white/[0.06] pb-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-zinc-50">Goals &amp; Events</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/20 bg-purple-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-purple-400">
              <Target className="h-3 w-3" />
              Conversion Tracking
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Conversion milestones, custom actions, and SDK telemetry for{" "}
            <span className="font-mono font-medium text-zinc-300">{site.domain}</span>
          </p>
        </div>

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

      {/* ── Conversion Goals Section ── */}
      <GoalsManager siteId={site.id} initialGoals={goalMetrics} />

      {/* ── Custom Events Explorer ── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              <CardTitle>Tracked Custom Events</CardTitle>
            </div>
            <CardDescription className="mt-1">
              Custom business events emitted from your frontend application via the SDK
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-[10px]">
            {customEvents.length} {customEvents.length === 1 ? "Event Type" : "Event Types"}
          </Badge>
        </CardHeader>

        <div className="space-y-4 pt-3 text-left">
          {customEvents.length === 0 ? (
            <div className="space-y-2 rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
              <p className="text-sm font-medium text-zinc-300">No custom events recorded yet</p>
              <p className="mx-auto max-w-md text-xs text-zinc-400">
                Trigger events in your app using the tracker snippet. For example:
              </p>
              <pre className="mx-auto max-w-md rounded-lg border border-white/10 bg-black/50 p-3 text-left font-mono text-xs text-zinc-300">
                {`window.trackme.trackEvent('button_clicked', { plan: 'pro' });`}
              </pre>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-zinc-400">
                    <th className="pb-3 font-semibold">Event Name</th>
                    <th className="pb-3 font-semibold text-right">Total Triggers</th>
                    <th className="pb-3 font-semibold text-right">Unique Sessions</th>
                    <th className="pb-3 font-semibold text-right">Unique Visitors</th>
                    <th className="pb-3 font-semibold text-right">Last Triggered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06] font-mono">
                  {customEvents.map((evt: CustomEventSummary) => (
                    <tr key={evt.eventName} className="transition hover:bg-white/[0.03]">
                      <td className="py-3 font-bold text-zinc-200">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                          <span>{evt.eventName}</span>
                        </div>
                      </td>
                      <td className="py-3 text-right text-zinc-300">
                        {evt.count.toLocaleString()}
                      </td>
                      <td className="py-3 text-right text-zinc-400">
                        {evt.uniqueSessions.toLocaleString()}
                      </td>
                      <td className="py-3 text-right text-zinc-400">
                        {evt.uniqueVisitors.toLocaleString()}
                      </td>
                      <td className="py-3 text-right font-sans text-[11px] text-zinc-400">
                        {formatRelativeTime(evt.lastSeen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Quick SDK Helper snippet */}
          <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-zinc-400 sm:flex-row sm:items-center sm:justify-between text-left">
            <span>
              Emit custom events anytime in client JavaScript:
            </span>
            <code className="rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-zinc-300">
              window.trackme.trackEvent(&apos;event_name&apos;, &#123; prop: &apos;val&apos; &#125;)
            </code>
          </div>
        </div>
      </Card>
    </div>
  );
}
