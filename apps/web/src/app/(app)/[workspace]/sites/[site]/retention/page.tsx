import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Users } from "lucide-react";
import { countIdentifiedUsers, getRetention, getRetentionEvents, type CohortRow } from "@trackme/analytics";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { TableCardSkeleton } from "@/components/ui/skeleton";
import { RetentionControls } from "@/components/retention-controls";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { cached } from "@/lib/query-cache";
import { getSavedSegment, listSavedSegments } from "@/lib/saved-segments";
import { matchSegment, SEGMENT_USER_CAP } from "@/lib/segments";
import { cohortWindow, parseRetentionView, periodLabel, WINDOW, type RetentionView } from "@/lib/retention-url";
import { formatNumber } from "@/lib/format";

const TTL_SECONDS = 300;
const key = (kind: string, siteId: string, input: unknown) => `q:v1:ret:${kind}:${siteId}:${JSON.stringify(input)}`;

export default async function RetentionPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; site: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  const view = parseRetentionView(await searchParams);

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;
  const base = `/${workspace.slug}/sites/${site.domain}/retention`;

  return (
    <div className="w-full space-y-5 text-left">
      <PageHeader
        title="Retention & Cohorts"
        art="steps"
        actions={
          <Suspense fallback={<div className="h-8 w-72 animate-pulse rounded-lg bg-white/[0.04]" />}>
            <Controls siteId={site.id} base={base} view={view} />
          </Suspense>
        }
      >
        Of the people who first showed up in a period, how many come back, for <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>

      <Suspense key={JSON.stringify(view)} fallback={<TableCardSkeleton rows={6} cols={8} />}>
        <CohortCard siteId={site.id} workspaceId={workspace.id} view={view} />
      </Suspense>
    </div>
  );
}

async function Controls({ siteId, base, view }: { siteId: string; base: string; view: RetentionView }) {
  const events = await cached(key("events", siteId, 0), TTL_SECONDS, () => getRetentionEvents(siteId))
    .then((rows) => rows.map((row) => row.name))
    .catch(() => []);
  const segments = await listSavedSegments(siteId)
    .then((list) => list.map(({ id, name }) => ({ id, name })))
    .catch(() => []);
  return <RetentionControls base={base} view={view} events={events} segments={segments} />;
}

async function CohortCard({ siteId, workspaceId, view }: { siteId: string; workspaceId: string; view: RetentionView }) {
  const periods = WINDOW[view.granularity];
  const { from, to } = cohortWindow(view.granularity);
  const query = {
    siteId,
    granularity: view.granularity,
    from,
    to,
    periods,
    cohort: view.cohortEvent ? ({ kind: "event", name: view.cohortEvent } as const) : ({ kind: "first_visit" } as const),
    ...(view.returnEvent ? { returnEvent: view.returnEvent } : {}),
  };

  let cohorts: CohortRow[];
  let identified: number;
  let segmentNote: { name: string; users: number; capped: boolean } | null = null;
  try {
    // A segment narrows the cohorts to the users it matches. Its definition is read for this site only.
    let userIds: string[] | undefined;
    if (view.segment) {
      const segment = await getSavedSegment(siteId, view.segment);
      if (segment) {
        const matched = await cached(key("segment", siteId, [view.segment, segment.definition]), TTL_SECONDS, async () => {
          const { rows, capped } = await matchSegment(workspaceId, siteId, segment.definition, SEGMENT_USER_CAP);
          return { ids: rows.map((row) => row.distinctId), capped };
        });
        userIds = matched.ids;
        segmentNote = { name: segment.name, users: matched.ids.length, capped: matched.capped };
      }
    }
    const filtered = { ...query, ...(userIds ? { userIds } : {}) };
    const cohortKey = [filtered.granularity, from, to, filtered.cohort, filtered.returnEvent ?? null, view.segment ?? null, userIds?.length ?? null];
    [cohorts, identified] = await Promise.all([
      cached(key("cohorts", siteId, cohortKey), TTL_SECONDS, () => getRetention(filtered)),
      cached(key("users", siteId, 0), TTL_SECONDS, () => countIdentifiedUsers(siteId)),
    ]);
  } catch {
    return (
      <Card className="py-12 text-center">
        <p className="text-sm text-zinc-300">Retention is temporarily unavailable.</p>
        <p className="mt-1 text-xs text-zinc-500">Nothing is lost. Reload in a moment.</p>
      </Card>
    );
  }

  if (identified === 0) return <NoIdentifiedUsers />;

  const totalSize = cohorts.reduce((sum, c) => sum + c.size, 0);
  const average = Array.from({ length: periods + 1 }, (_, k) => {
    const have = cohorts.filter((c) => c.retained[k] !== null && c.retained[k] !== undefined);
    const size = have.reduce((sum, c) => sum + c.size, 0);
    return size > 0 ? have.reduce((sum, c) => sum + (c.retained[k] ?? 0), 0) / size : null;
  });

  return (
    <Card className="overflow-hidden px-0 pb-0">
      <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4 text-zinc-300" />
          {view.cohortEvent ? `People who did "${view.cohortEvent}"` : "People by first visit"}, {view.returnEvent ? `back to "${view.returnEvent}"` : "back for anything"}
        </CardTitle>
        <CardDescription>
          Based on {formatNumber(identified)} identified {identified === 1 ? "user" : "users"}. Anonymous visitors get a new ID every 24 hours,
          so they cannot be followed across days and are not counted. Call <code className="font-mono">trackme.identify()</code> to include someone.
        </CardDescription>
      </CardHeader>

      {segmentNote && (
        <p className="border-b border-white/[0.06] px-5 py-2 text-xs text-zinc-400">
          Segment <span className="font-medium text-zinc-200">{segmentNote.name}</span>: {formatNumber(segmentNote.users)}
          {segmentNote.capped ? "+" : ""} identified {segmentNote.users === 1 ? "user" : "users"}
          {segmentNote.capped ? `. Only the ${formatNumber(SEGMENT_USER_CAP)} most recently active were used, so the chart is a sample.` : "."}
        </p>
      )}

      {totalSize === 0 ? (
        <p className="px-5 py-12 text-center text-xs text-zinc-500">
          No users in these cohorts yet{view.cohortEvent ? ` (nobody has done "${view.cohortEvent}" in this window)` : ""}. Try another event or a longer granularity.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-xs">
            <caption className="sr-only">Retention by cohort: the share of each cohort active in each following period</caption>
            <thead>
              <tr className="text-zinc-500">
                <th scope="col" className="sticky left-0 z-10 bg-card px-5 py-3 text-left font-medium">Cohort</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Users</th>
                {Array.from({ length: periods + 1 }, (_, k) => (
                  <th key={k} scope="col" className="px-1 py-3 text-center font-medium">{periodLabel(view.granularity, k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((cohort) => (
                <tr key={cohort.cohort}>
                  <th scope="row" className="sticky left-0 z-10 border-t border-white/[0.05] bg-card px-5 py-1.5 text-left font-mono font-normal text-zinc-300">
                    {cohort.cohort}
                  </th>
                  <td className="border-t border-white/[0.05] px-3 py-1.5 text-right font-mono tabular-nums text-zinc-200">{formatNumber(cohort.size)}</td>
                  {cohort.retained.map((count, k) => (
                    <Cell key={k} count={count} size={cohort.size} label={`${cohort.cohort}, ${periodLabel(view.granularity, k)}`} />
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="sticky left-0 z-10 border-t border-white/[0.12] bg-card px-5 py-2 text-left font-medium text-zinc-200">Average</th>
                <td className="border-t border-white/[0.12] px-3 py-2 text-right font-mono tabular-nums text-zinc-400">{formatNumber(totalSize)}</td>
                {average.map((share, k) => (
                  <td key={k} className="border-t border-white/[0.12] px-1 py-2 text-center font-mono tabular-nums text-zinc-300">
                    {share === null ? "–" : `${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%`}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** A cell shows its percentage as a number and shades by it; the shade is never the only carrier of the value. */
function Cell({ count, size, label }: { count: number | null; size: number; label: string }) {
  if (count === null) {
    return <td className="border-t border-white/[0.05] px-1 py-1.5 text-center text-zinc-700" aria-label={`${label}: not yet`}>–</td>;
  }
  const share = size > 0 ? count / size : 0;
  return (
    <td
      className="border-t border-white/[0.05] px-1 py-1"
      title={`${count} of ${size} users`}
      aria-label={`${label}: ${(share * 100).toFixed(1)}% (${count} of ${size} users)`}
    >
      <div
        className="rounded-md px-1 py-1 text-center font-mono tabular-nums text-zinc-50"
        style={{ background: share > 0 ? `rgba(76, 195, 138, ${(0.08 + 0.55 * share).toFixed(2)})` : "transparent" }}
      >
        {(share * 100).toFixed(share >= 0.1 || share === 0 ? 0 : 1)}%
      </div>
    </td>
  );
}

function NoIdentifiedUsers() {
  const snippet = `trackme.identify("user_123", { plan: "pro" });`;
  return (
    <Card className="mx-auto max-w-2xl space-y-4 py-10 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-400">
        <Users className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-zinc-100">Retention follows identified users</h3>
        <p className="mx-auto max-w-md text-xs leading-relaxed text-zinc-400">
          TrackMe gives anonymous visitors a new ID every 24 hours, so it cannot tell whether they came back. Call identify() when someone
          signs in and their later visits are linked, so you can see how many return after a day, a week or a month.
        </p>
      </div>
      <div className="mx-auto flex max-w-sm items-center gap-2 rounded-lg border border-white/10 bg-black/40 p-3 text-left">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-zinc-300">{snippet}</code>
        <CopyButton text={snippet} variant="ghost" />
      </div>
    </Card>
  );
}
