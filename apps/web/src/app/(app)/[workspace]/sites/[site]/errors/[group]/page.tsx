import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { hasPermission } from "@trackme/authz";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/ui/stats-card";
import { Sparkline } from "@/components/ui/sparkline";
import { RankingList } from "@/components/ui/ranking-list";
import { RangeSwitcher } from "@/components/range-switcher";
import { ErrorStatusActions } from "@/components/error-status-actions";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { loadStatusesFor } from "@/lib/error-status";
import {
  cachedErrorBreakdown,
  cachedErrorGroup,
  cachedErrorTrends,
  cachedOccurrences,
  cachedTags,
} from "@/lib/errors-view";
import { fillDays, rangeDates } from "@/lib/errors-url";
import { symbolicate } from "@/lib/sourcemaps";
import { parseRangeKey } from "@/lib/date-range";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import { ErrorStatusChip, LevelBadge } from "../badges";

interface Frame {
  fn?: string;
  file: string;
  line?: number;
  col?: number;
  inApp?: boolean;
}
interface Crumb {
  ts: number;
  k: string;
  m: string;
}

/** Stored JSON from the worker; a damaged value shows as empty rather than breaking the page. */
function parseJson<T>(text: string, fallback: T): T {
  try {
    const value = JSON.parse(text) as unknown;
    return (Array.isArray(fallback) ? (Array.isArray(value) ? value : fallback) : value) as T;
  } catch {
    return fallback;
  }
}

const CRUMB_LABEL: Record<string, string> = { navigation: "Page", click: "Click", fetch: "Request", log: "Log" };

export default async function ErrorIssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; site: string; group: string }>;
  searchParams: Promise<{ range?: string; occ?: string }>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain, group: groupId } = await params;
  const { range: rawRange, occ } = await searchParams;
  const range = parseRangeKey(rawRange);

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;
  if (!/^\d{1,20}$/.test(groupId)) notFound();

  const { from, to, days } = rangeDates(range);
  const [group, statuses, breakdown, trend, occurrences, tags] = await Promise.all([
    cachedErrorGroup(site.id, groupId),
    loadStatusesFor(site.id, [groupId]),
    cachedErrorBreakdown(site.id, groupId, from, to).catch(() => []),
    cachedErrorTrends(site.id, [groupId], from, to).catch(() => []),
    cachedOccurrences(workspace.id, site.id, groupId).catch(() => []),
    cachedTags(workspace.id, site.id, groupId).catch(() => []),
  ]);
  if (!group) notFound();

  const status = statuses.get(groupId);
  const base = `/${workspace.slug}/sites/${site.domain}`;
  const selected = occurrences.find((o) => o.eventId === occ) ?? occurrences[0];
  const rawFrames = selected ? parseJson<Frame[]>(selected.stack, []) : [];
  // Minified frames become readable when a source map was uploaded for this release. Without one, the raw trace shows.
  const { frames, mapped } =
    selected && rawFrames.length > 0
      ? await symbolicate(site.id, selected.release, rawFrames).catch(() => ({ frames: rawFrames, mapped: 0 }))
      : { frames: rawFrames, mapped: 0 };
  const crumbs = selected ? parseJson<Crumb[]>(selected.breadcrumbs, []) : [];
  const errorTime = selected ? Date.parse(selected.occurredAt) : NaN;
  const users = [...new Set(occurrences.map((o) => o.userId).filter(Boolean))];
  const inRange = breakdown.reduce((sum, slice) => sum + slice.events, 0);
  const releaseRows = breakdown.map((slice) => ({
    name: `${slice.release || "(no release)"} · ${slice.environment}`,
    value: slice.events,
    percentage: inRange > 0 ? (slice.events / inRange) * 100 : 0,
    meta: `${formatNumber(slice.users)} users`,
  }));

  return (
    <div className="w-full space-y-5 text-left">
      <Link href={`${base}/errors`} className="inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-100">
        <ArrowLeft className="h-3.5 w-3.5" /> All issues
      </Link>

      <PageHeader
        title={group.type}
        art="pulse"
        actions={
          <>
            <RangeSwitcher range={range} />
            <ErrorStatusActions
              siteId={site.id}
              groupId={groupId}
              status={status?.status ?? "open"}
              canEdit={hasPermission(workspace.role, "sites:update")}
            />
          </>
        }
      >
        <span className="mb-2 flex flex-wrap items-center gap-2">
          <LevelBadge level={group.level} />
          <ErrorStatusChip status={status?.status ?? "open"} regressedIn={status?.regressedAt ? (status.regressedIn ?? "") : null} />
        </span>
        {group.title.slice(group.type.length + 2) || group.title}
      </PageHeader>

      {status?.regressedAt && (
        <p role="status" className="rounded-xl border border-[#e5484d]/25 bg-[#e5484d]/[0.06] px-4 py-3 text-xs text-zinc-200">
          This issue was resolved and came back {formatRelativeTime(status.regressedAt.toISOString())}
          {status.regressedIn ? <> in <span className="font-mono">{status.regressedIn}</span></> : null}. It is open again.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard title="Events" value={formatNumber(inRange)} subtitle={`In the last ${range}; ${formatNumber(group.totalEvents)} ever`} />
        <StatsCard title="Users affected" value={formatNumber(group.totalUsers)} subtitle="Ever; identified users, else visitors (new each day)" />
        <StatsCard title="First seen" value={formatRelativeTime(group.firstSeen)} subtitle={group.firstRelease ? `In ${group.firstRelease}` : "No release tag"} />
        <StatsCard title="Last seen" value={formatRelativeTime(group.lastSeen)} subtitle={group.lastRelease ? `In ${group.lastRelease}` : "No release tag"} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Events per day</CardTitle>
          <CardDescription>Over the last {range}</CardDescription>
        </CardHeader>
        <Sparkline
          values={fillDays(days, trend)}
          timestamps={days}
          granularity="day"
          name="Events"
          variant="bar"
          className="h-24"
          emptyHint="No events in this range"
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="overflow-hidden px-0 pb-0">
            <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
              <CardTitle className="flex items-center gap-2">
                Stack trace
                {mapped > 0 && <span className="rounded border border-border px-1.5 py-px text-[11px] font-normal text-zinc-300">Source-mapped</span>}
              </CardTitle>
              <CardDescription>
                {selected
                  ? `${formatRelativeTime(selected.occurredAt)} · ${selected.release || "no release"} · ${selected.browser || "unknown browser"} · ${selected.path}`
                  : "No detailed occurrence stored yet. Counts are exact; detail is kept for the first 5 events of each day."}
              </CardDescription>
            </CardHeader>
            {mapped === 0 && frames.length > 0 && selected?.release && (
              <p className="border-b border-white/[0.04] px-5 py-2 text-xs text-zinc-500">
                Names look minified? Upload a source map for <span className="font-mono">{selected.release}</span> to read the original code.
              </p>
            )}
            {frames.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-zinc-500">{selected ? "This report had no stack trace." : "Waiting for a detailed occurrence."}</p>
            ) : (
              <ol className="divide-y divide-white/[0.04] font-mono text-xs">
                {frames.map((frame, i) => (
                  <li key={i} className={`px-5 py-2 ${frame.inApp ? "bg-white/[0.04]" : ""}`}>
                    <div className="flex items-center gap-2">
                      <span className={frame.inApp ? "font-medium text-zinc-50" : "text-zinc-400"}>{frame.fn || "(anonymous)"}</span>
                      {frame.inApp && <span className="rounded border border-border px-1 text-[10px] text-zinc-300">your code</span>}
                    </div>
                    <div className={`truncate ${frame.inApp ? "text-zinc-300" : "text-zinc-500"}`} title={frame.file}>
                      {frame.file}
                      {frame.line !== undefined ? `:${frame.line}${frame.col !== undefined ? `:${frame.col}` : ""}` : ""}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>What happened before</CardTitle>
              <CardDescription>The last actions leading up to this error</CardDescription>
            </CardHeader>
            {crumbs.length === 0 ? (
              <p className="py-4 text-center text-xs text-zinc-500">No breadcrumbs were recorded.</p>
            ) : (
              <ol className="space-y-2 text-xs">
                {crumbs.map((crumb, i) => {
                  const offset = Number.isFinite(errorTime) ? (crumb.ts - errorTime) / 1000 : null;
                  return (
                    <li key={i} className="flex items-baseline gap-3">
                      <span className="w-14 shrink-0 text-right font-mono text-zinc-500">
                        {offset === null ? "" : offset > -0.05 ? "now" : `${offset.toFixed(1)}s`}
                      </span>
                      <span className="w-14 shrink-0 text-zinc-400">{CRUMB_LABEL[crumb.k] ?? crumb.k}</span>
                      <span className="min-w-0 break-words font-mono text-zinc-200">{crumb.m}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="border-b border-white/[0.06] pb-3">
              <CardTitle>Releases</CardTitle>
              <CardDescription>Which builds raise it</CardDescription>
            </CardHeader>
            <RankingList items={releaseRows} empty="No events in this range." />
          </Card>

          <Card>
            <CardHeader className="border-b border-white/[0.06] pb-3">
              <CardTitle>Tags</CardTitle>
              <CardDescription>From the sampled occurrences</CardDescription>
            </CardHeader>
            <RankingList
              items={tags.map((tag) => ({
                name: `${tag.key}: ${tag.value}`,
                value: tag.count,
                percentage: occurrences.length > 0 ? (tag.count / occurrences.length) * 100 : 0,
              }))}
              empty="No tags on these reports."
            />
          </Card>

          <Card>
            <CardHeader className="border-b border-white/[0.06] pb-3">
              <CardTitle>Affected users</CardTitle>
              <CardDescription>Identified users in the sampled occurrences</CardDescription>
            </CardHeader>
            {users.length === 0 ? (
              <p className="py-4 text-center text-xs text-zinc-500">No identified users. Call trackme.identify() to see who is affected.</p>
            ) : (
              <ul className="divide-y divide-white/[0.05]">
                {users.map((id) => (
                  <li key={id}>
                    <Link href={`${base}/people?q=${encodeURIComponent(id)}`} className="flex items-center justify-between gap-3 px-1 py-2 text-xs text-zinc-200 hover:text-white">
                      <span className="truncate font-mono">{id}</span>
                      <span className="shrink-0 text-zinc-500">Open profile</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {occurrences.length > 1 && (
            <Card>
              <CardHeader className="border-b border-white/[0.06] pb-3">
                <CardTitle>Occurrences</CardTitle>
                <CardDescription>Pick one to see its stack and breadcrumbs</CardDescription>
              </CardHeader>
              <ul className="divide-y divide-white/[0.05]">
                {occurrences.slice(0, 10).map((o) => (
                  <li key={o.eventId}>
                    <Link
                      href={`?${new URLSearchParams({ ...(range !== "30d" ? { range } : {}), occ: o.eventId }).toString()}`}
                      scroll={false}
                      aria-current={o.eventId === selected?.eventId ? "true" : undefined}
                      className={`flex items-center justify-between gap-3 px-1 py-2 text-xs ${o.eventId === selected?.eventId ? "text-zinc-50" : "text-zinc-400 hover:text-zinc-100"}`}
                    >
                      <span>{formatRelativeTime(o.occurredAt)}</span>
                      <span className="truncate font-mono text-zinc-500">{o.release || "no release"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
