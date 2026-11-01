import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { notFound } from "next/navigation";
import { MousePointerClick, Download, ArrowDownToLine, Zap } from "lucide-react";
import { db, goals, eq, desc } from "@trackme/db";
import {
  AUTO_EVENT_NAMES,
  getCustomEventsSummary,
  getGoalMetrics,
  type CustomEventSummary,
} from "@trackme/analytics";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { buildMetricRequest } from "@/lib/metrics";
import { parseRangeKey, resolveDateRange, type RangeKey } from "@/lib/date-range";
import { RangeSwitcher } from "@/components/range-switcher";
import { TableCardSkeleton } from "@/components/ui/skeleton";
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

  return (
    <div className="w-full space-y-5 text-left">
      <PageHeader title="Goals & Events" art="pulse" actions={<RangeSwitcher range={range} />}>
        Conversions, custom actions and SDK events on <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>

      <Suspense key={range} fallback={<div className="space-y-5"><TableCardSkeleton rows={4} cols={4} /><TableCardSkeleton rows={6} cols={5} /></div>}>
        <EventsBody workspaceId={workspace.id} siteId={site.id} range={range} />
      </Suspense>
    </div>
  );
}

async function EventsBody({ workspaceId, siteId, range }: { workspaceId: string; siteId: string; range: RangeKey }) {
  const { current } = resolveDateRange(range);
  const request = buildMetricRequest(workspaceId, siteId, current);

  // Fetch defined goals from DB
  const rawGoals = await db
    .select()
    .from(goals)
    .where(eq(goals.siteId, siteId))
    .orderBy(desc(goals.createdAt));

  // Compute conversion metrics against ClickHouse
  const [goalMetrics, customEvents] = await Promise.all([
    getGoalMetrics(
      workspaceId,
      siteId,
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

  const isAuto = (name: string) => (AUTO_EVENT_NAMES as readonly string[]).includes(name);
  const autoEvents = customEvents.filter((e: CustomEventSummary) => isAuto(e.eventName));
  const customEvents_ = customEvents.filter((e: CustomEventSummary) => !isAuto(e.eventName));

  return (
    <div className="space-y-5 reveal">
      {/* ── Conversion Goals Section ── */}
      <GoalsManager siteId={siteId} initialGoals={goalMetrics} />

      {/* ── Custom Events Explorer ── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-zinc-300" />
              <CardTitle>Tracked Custom Events</CardTitle>
            </div>
            <CardDescription className="mt-1">
              Custom business events emitted from your frontend application via the SDK
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {customEvents_.length} {customEvents_.length === 1 ? "Event Type" : "Event Types"}
          </Badge>
        </CardHeader>

        <div className="space-y-4 pt-3 text-left">
          {customEvents_.length === 0 ? (
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
                  <tr className="border-b border-white/[0.06] text-xs text-zinc-400">
                    <th className="pb-3 font-medium">Event Name</th>
                    <th className="pb-3 font-medium text-right">Total Triggers</th>
                    <th className="pb-3 font-medium text-right">Unique Sessions</th>
                    <th className="pb-3 font-medium text-right">Unique Visitors</th>
                    <th className="pb-3 font-medium text-right">Last Triggered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06] font-mono">
                  {customEvents_.map((evt: CustomEventSummary) => (
                    <tr key={evt.eventName} className="transition hover:bg-white/[0.03]">
                      <td className="py-3 font-medium text-zinc-200">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
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
                      <td className="py-3 text-right font-sans text-xs text-zinc-400">
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
            <code className="rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-xs text-zinc-300">
              window.trackme.trackEvent(&apos;event_name&apos;, &#123; prop: &apos;val&apos; &#125;)
            </code>
          </div>
        </div>
      </Card>

      <AutoCaptured events={autoEvents} />
    </div>
  );
}

const AUTO_EVENT_INFO: Record<string, { label: string; description: string; icon: typeof Download }> = {
  outbound_click: {
    label: "Outbound link clicks",
    description: "Visitors who left through a link to another website",
    icon: MousePointerClick,
  },
  file_download: {
    label: "File downloads",
    description: "Clicks on PDFs, archives, documents, and other files",
    icon: Download,
  },
  scroll_depth: {
    label: "Scroll depth",
    description: "Pages scrolled to 25%, 50%, 75%, and 100%",
    icon: ArrowDownToLine,
  },
};

/** Events the tracker records on its own, with no code on your side. */
function AutoCaptured({ events }: { events: CustomEventSummary[] }) {
  const byName = new Map(events.map((e) => [e.eventName, e]));
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
        <div>
          <CardTitle>Captured automatically</CardTitle>
          <CardDescription className="mt-1">
            Recorded by the tracker with no setup. Turn off with <code className="font-mono">data-auto-events=&quot;false&quot;</code>
          </CardDescription>
        </div>
        <Badge variant="outline" className="font-mono text-xs">Auto</Badge>
      </CardHeader>
      <div className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-3">
        {Object.entries(AUTO_EVENT_INFO).map(([name, info]) => {
          const evt = byName.get(name);
          const Icon = info.icon;
          return (
            <div key={name} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 text-zinc-300">
                <Icon className="h-4 w-4 text-zinc-200" />
                <span className="text-xs font-medium">{info.label}</span>
              </div>
              <p className="mt-3 font-mono text-2xl font-medium tabular-nums text-zinc-50">{(evt?.count ?? 0).toLocaleString()}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {evt ? `${evt.uniqueVisitors.toLocaleString()} visitors · ${formatRelativeTime(evt.lastSeen)}` : "None yet in this range"}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-400">{info.description}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
