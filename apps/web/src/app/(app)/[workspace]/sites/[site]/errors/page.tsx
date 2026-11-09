import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Bug, ChevronRight } from "lucide-react";
import { hasPermission } from "@trackme/authz";
import { groupFilter } from "@trackme/contracts";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/ui/sparkline";
import { CopyButton } from "@/components/ui/copy-button";
import { TableCardSkeleton } from "@/components/ui/skeleton";
import { ErrorFilterBar } from "@/components/error-filter-bar";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { loadErrorStatuses } from "@/lib/error-status";
import { cachedErrorList, cachedErrorOptions, cachedErrorTrends } from "@/lib/errors-view";
import { errorsHref, fillDays, parseErrorFilters, rangeDates, type ErrorFilters } from "@/lib/errors-url";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import { ErrorStatusChip, LevelBadge } from "./badges";

const PAGE_SIZE = 25;

export default async function ErrorTrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; site: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  const filters = parseErrorFilters(await searchParams);

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;
  const base = `/${workspace.slug}/sites/${site.domain}/errors`;
  const { from, to } = rangeDates(filters.range);

  return (
    <div className="w-full space-y-5 text-left">
      <PageHeader
        title="Error Tracking"
        art="pulse"
        actions={
          <Suspense fallback={<div className="h-8 w-64 animate-pulse rounded-lg bg-white/[0.04]" />}>
            <Filters siteId={site.id} base={base} filters={filters} from={from} to={to} />
          </Suspense>
        }
      >
        Every distinct error on <span className="font-mono text-zinc-300">{site.domain}</span>, grouped, with who it hit and which release brought it
      </PageHeader>

      <Suspense key={JSON.stringify(filters)} fallback={<TableCardSkeleton rows={6} cols={4} />}>
        <IssueList
          siteId={site.id}
          base={base}
          filters={filters}
          canEdit={hasPermission(workspace.role, "sites:update")}
        />
      </Suspense>
    </div>
  );
}

async function Filters({ siteId, base, filters, from, to }: { siteId: string; base: string; filters: ErrorFilters; from: string; to: string }) {
  // The dropdowns still work, with only the current choice listed, if their query fails.
  const options = await cachedErrorOptions(siteId, from, to).catch(() => ({ releases: [], environments: [] }));
  const withCurrent = (all: string[], current?: string) => (current && !all.includes(current) ? [current, ...all] : all);
  return (
    <ErrorFilterBar
      base={base}
      filters={filters}
      releases={withCurrent(options.releases, filters.release)}
      environments={withCurrent(options.environments, filters.environment)}
    />
  );
}

async function IssueList({ siteId, base, filters, canEdit }: { siteId: string; base: string; filters: ErrorFilters; canEdit: boolean }) {
  const { from, to, days } = rangeDates(filters.range);
  const statuses = await loadErrorStatuses(siteId);
  const byId = new Map(statuses.map((s) => [s.groupId, s]));

  let page: Awaited<ReturnType<typeof cachedErrorList>>;
  try {
    page = await cachedErrorList({
      siteId,
      from,
      to,
      sort: filters.sort,
      limit: PAGE_SIZE,
      ...groupFilter(statuses, filters.status),
      ...(filters.release ? { release: filters.release } : {}),
      ...(filters.environment ? { environment: filters.environment } : {}),
      ...(filters.level ? { level: filters.level } : {}),
      ...(filters.cursor ? { cursor: filters.cursor } : {}),
    });
  } catch {
    return (
      <Card className="py-12 text-center">
        <p className="text-sm text-zinc-300">Errors are temporarily unavailable.</p>
        <p className="mt-1 text-xs text-zinc-500">Nothing is lost: events keep arriving. Reload in a moment.</p>
        <Link href={errorsHref(base, filters)} className="mt-4 inline-block rounded-md border border-border px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/[0.05]">
          Retry
        </Link>
      </Card>
    );
  }

  if (page.groups.length === 0) {
    return <EmptyState filtered={filters.status !== "open" || Boolean(filters.release || filters.environment || filters.level || filters.cursor)} base={base} filters={filters} />;
  }

  const trends = await cachedErrorTrends(siteId, page.groups.map((g) => g.groupId), from, to).catch(() => []);
  const series = new Map<string, number[]>();
  for (const group of page.groups) {
    series.set(group.groupId, fillDays(days, trends.filter((t) => t.groupId === group.groupId)));
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="hidden grid-cols-[minmax(0,1fr)_120px_80px_80px_110px] gap-4 border-b border-white/[0.06] px-5 py-3 text-xs text-zinc-500 md:grid">
        <span>Issue</span>
        <span>Trend</span>
        <span className="text-right">Events</span>
        <span className="text-right">Users</span>
        <span className="text-right">Last seen</span>
      </div>
      <ul className="divide-y divide-white/[0.05]">
        {page.groups.map((group) => {
          const status = byId.get(group.groupId);
          return (
            <li key={group.groupId}>
              <Link
                href={`${base}/${group.groupId}${filters.range !== "30d" ? `?range=${filters.range}` : ""}`}
                className="grid grid-cols-1 gap-2 px-5 py-4 transition-colors hover:bg-white/[0.03] md:grid-cols-[minmax(0,1fr)_120px_80px_80px_110px] md:items-center md:gap-4"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <LevelBadge level={group.level} />
                    <span className="truncate text-[13px] font-medium text-zinc-100" title={group.title}>
                      {group.title}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                    <ErrorStatusChip status={status?.status ?? "open"} regressedIn={status?.regressedAt ? (status.regressedIn ?? "") : null} />
                    <span>first seen {formatRelativeTime(group.firstSeen)}</span>
                    {group.lastRelease && <span className="font-mono">{group.lastRelease}</span>}
                  </div>
                </div>
                <div className="hidden md:block">
                  <Sparkline
                    values={series.get(group.groupId) ?? []}
                    timestamps={days}
                    granularity="day"
                    name="Events"
                    emptyHint="No events in this range"
                  />
                </div>
                <span className="font-mono text-xs tabular-nums text-zinc-200 md:text-right">
                  {formatNumber(group.events)} <span className="text-zinc-500 md:hidden">events</span>
                </span>
                <span className="font-mono text-xs tabular-nums text-zinc-300 md:text-right">
                  {formatNumber(group.users)} <span className="text-zinc-500 md:hidden">users</span>
                </span>
                <span className="flex items-center justify-between text-xs text-zinc-400 md:justify-end md:gap-2">
                  {formatRelativeTime(group.lastSeen)}
                  <ChevronRight className="h-4 w-4 text-zinc-600" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {(page.nextCursor || filters.cursor) && (
        <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3 text-xs">
          {filters.cursor ? (
            <Link href={errorsHref(base, filters, { cursor: undefined })} className="text-zinc-400 hover:text-zinc-100">
              Back to the first page
            </Link>
          ) : (
            <span />
          )}
          {page.nextCursor && (
            <Link href={errorsHref(base, filters, { cursor: page.nextCursor })} className="font-medium text-zinc-200 hover:text-white">
              Next {PAGE_SIZE}
            </Link>
          )}
        </div>
      )}
      {!canEdit && <p className="border-t border-white/[0.06] px-5 py-3 text-xs text-zinc-500">You can view issues; resolving them needs member access.</p>}
    </Card>
  );
}

function EmptyState({ filtered, base, filters }: { filtered: boolean; base: string; filters: ErrorFilters }) {
  const snippet = `<script defer src="…/tracker.js" data-site="YOUR_SITE_KEY" data-endpoint="…" data-errors="true" data-release="web@1.0.0"></script>`;
  if (filtered) {
    return (
      <Card className="py-12 text-center">
        <p className="text-sm text-zinc-300">No issues match these filters.</p>
        <Link href={errorsHref(base, { ...filters, range: filters.range }, { status: "open", release: undefined, environment: undefined, level: undefined, cursor: undefined })} className="mt-3 inline-block text-xs text-zinc-400 hover:text-zinc-100">
          Clear filters
        </Link>
      </Card>
    );
  }
  return (
    <Card className="mx-auto max-w-2xl space-y-4 py-10 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-400">
        <Bug className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-zinc-100">No errors in this range</h3>
        <p className="mx-auto max-w-md text-xs leading-relaxed text-zinc-400">
          Either your site is healthy, or error capture is off. Add <code className="font-mono">data-errors=&quot;true&quot;</code> to your tracker
          snippet and tag the build with <code className="font-mono">data-release</code>, so each issue shows which release brought it.
        </p>
      </div>
      <div className="mx-auto flex max-w-xl items-center gap-2 rounded-lg border border-border bg-black/40 p-3 text-left">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-zinc-300">{snippet}</code>
        <CopyButton text={snippet} variant="ghost" />
      </div>
    </Card>
  );
}
