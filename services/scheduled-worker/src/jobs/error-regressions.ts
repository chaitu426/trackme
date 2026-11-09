import { getRecentReleasesForGroups, type RecentRelease } from "@trackme/analytics";
import { findRegression, type ErrorStatusState } from "@trackme/contracts";
import { and, db, eq, siteErrorStatus } from "@trackme/db";

/** An issue someone marked resolved, as the job needs to see it. */
export interface ResolvedIssue {
  id: string;
  siteId: string;
  groupId: string;
  state: Pick<ErrorStatusState, "status" | "mode" | "resolvedAt" | "knownReleases">;
}

export interface RegressionDeps {
  loadResolved(): Promise<ResolvedIssue[]>;
  /** Where each listed issue has appeared since its resolve time. */
  fetchSeen(issues: ResolvedIssue[]): Promise<RecentRelease[]>;
  /** Marks one issue open and regressed. Returns false if it was no longer resolved (someone changed it meanwhile). */
  reopen(issue: ResolvedIssue, release: string, now: Date): Promise<boolean>;
  /** Called after an issue was reopened, to tell the alert engine. A failure here never undoes the reopen. */
  onReopened?(issue: ResolvedIssue, release: string, now: Date): Promise<void>;
  now?: Date;
}

/** Issues per ClickHouse query. The query is bounded by the 30-day error_events table and the issue list itself. */
export const BATCH = 500;

/**
 * Reopens every resolved issue that has come back (see findRegression for what "back" means). Idempotent: an issue
 * already reopened is no longer resolved, so a second run finds nothing, and a concurrent change by a person wins
 * because the update only applies to rows still resolved. Returns how many issues were reopened.
 */
export async function detectRegressions(deps: RegressionDeps): Promise<number> {
  const now = deps.now ?? new Date();
  const resolved = await deps.loadResolved();
  let reopened = 0;

  for (let i = 0; i < resolved.length; i += BATCH) {
    const batch = resolved.slice(i, i + BATCH);
    const seen = await deps.fetchSeen(batch);
    const bySite = new Map<string, RecentRelease[]>();
    for (const row of seen) {
      const key = `${row.siteId}:${row.groupId}`;
      bySite.set(key, [...(bySite.get(key) ?? []), row]);
    }

    for (const issue of batch) {
      const events = (bySite.get(`${issue.siteId}:${issue.groupId}`) ?? []).map((r) => ({
        release: r.release,
        lastSeen: new Date(r.lastSeen),
      }));
      const regression = findRegression(issue.state, events);
      if (regression && (await deps.reopen(issue, regression.release, now))) {
        reopened += 1;
        if (deps.onReopened) await deps.onReopened(issue, regression.release, now).catch(() => undefined);
      }
    }
  }
  return reopened;
}

/** The job as scheduled: Postgres for the decisions, ClickHouse for what has happened since. */
export async function runErrorRegressions(onReopened?: RegressionDeps["onReopened"]): Promise<number> {
  return detectRegressions({
    ...(onReopened ? { onReopened } : {}),
    loadResolved: async () => {
      const rows = await db.select().from(siteErrorStatus).where(eq(siteErrorStatus.status, "resolved"));
      return rows.map((row) => ({
        id: row.id,
        siteId: row.siteId,
        groupId: row.groupId,
        state: {
          status: "resolved" as const,
          mode: row.mode === "next_release" ? ("next_release" as const) : ("now" as const),
          resolvedAt: row.resolvedAt,
          knownReleases: row.knownReleases,
        },
      }));
    },
    fetchSeen: (issues) =>
      getRecentReleasesForGroups(
        issues.map((issue) => ({
          siteId: issue.siteId,
          groupId: issue.groupId,
          since: (issue.state.resolvedAt ?? new Date(0)).toISOString(),
        }))
      ),
    reopen: async (issue, release, now) => {
      const updated = await db
        .update(siteErrorStatus)
        .set({
          status: "open",
          mode: "now",
          resolvedAt: null,
          knownReleases: [],
          regressedAt: now,
          regressedIn: release,
          updatedAt: now,
        })
        .where(and(eq(siteErrorStatus.id, issue.id), eq(siteErrorStatus.status, "resolved")))
        .returning({ id: siteErrorStatus.id });
      return updated.length > 0;
    },
  });
}
