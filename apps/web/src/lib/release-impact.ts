import { createHash } from "node:crypto";
import { and, asc, db, eq, goals, siteErrorStatus, siteReleases } from "@trackme/db";
import {
  buildReport,
  gatherReportInput,
  getReleasesSeen,
  MAX_WINDOW_HOURS,
  type ReleaseReport,
  type ReleaseSeen,
} from "@trackme/analytics";
import { cached } from "@/lib/query-cache";

const TTL_SECONDS = 300;
export const WINDOW_CHOICES = [6, 24, 72] as const;

export function parseWindowHours(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (WINDOW_CHOICES as readonly number[]).includes(n) ? n : 24;
}

const key = (kind: string, siteId: string, input: unknown) =>
  `q:v1:rel:${kind}:${siteId}:${createHash("sha1").update(JSON.stringify(input)).digest("hex")}`;

export interface ReleaseListItem {
  release: string;
  /** When it went live: the deploy webhook if it was reported, else the first session seen on it. */
  at: string;
  /** "webhook" or "first session". */
  source: "deploy" | "first-seen";
  commit: string | null;
  sessions: number;
}

/** Releases of a site, newest first: deploys reported by CI joined with the builds that actually had sessions. */
export async function listReleases(siteId: string): Promise<ReleaseListItem[]> {
  const [seen, deploys] = await Promise.all([
    cached(key("seen", siteId, 0), TTL_SECONDS, () => getReleasesSeen(siteId)).catch((): ReleaseSeen[] => []),
    db.select().from(siteReleases).where(and(eq(siteReleases.siteId, siteId), eq(siteReleases.environment, "production"))),
  ]);
  const deployed = new Map(deploys.map((d) => [d.version, d]));
  const items = new Map<string, ReleaseListItem>();
  for (const s of seen) {
    const d = deployed.get(s.release);
    items.set(s.release, {
      release: s.release,
      at: d ? d.deployedAt.toISOString() : s.firstSeen,
      source: d ? "deploy" : "first-seen",
      commit: d?.commit ?? null,
      sessions: s.sessions,
    });
  }
  for (const d of deploys) {
    if (!items.has(d.version)) {
      items.set(d.version, { release: d.version, at: d.deployedAt.toISOString(), source: "deploy", commit: d.commit, sessions: 0 });
    }
  }
  return [...items.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * The report for one release, or null when the release is unknown. The goal used for conversion is the site's first
 * enabled goal. Cached for 5 minutes (single flight), so many viewers cost one set of queries. The caller must have
 * authorized the site.
 */
export async function loadReleaseReport(siteId: string, release: string, windowHours: number): Promise<ReleaseReport | null> {
  const hours = Math.min(windowHours, MAX_WINDOW_HOURS);
  const list = await listReleases(siteId);
  const item = list.find((r) => r.release === release);
  if (!item) return null;

  return cached(key("report", siteId, [release, hours, item.at]), TTL_SECONDS, async () => {
    const [goal] = await db
      .select({ name: goals.name, type: goals.type, eventName: goals.eventName, pathPattern: goals.pathPattern })
      .from(goals)
      .where(and(eq(goals.siteId, siteId), eq(goals.enabled, true)))
      .orderBy(asc(goals.createdAt))
      .limit(1);

    const [gathered, regressed] = await Promise.all([
      gatherReportInput({ siteId, release, deployedAt: item.at, windowHours: hours, goal: goal ?? null }),
      db.select({ id: siteErrorStatus.id }).from(siteErrorStatus).where(and(eq(siteErrorStatus.siteId, siteId), eq(siteErrorStatus.regressedIn, release))),
    ]);

    return buildReport({
      release,
      previousRelease: gathered.previousRelease,
      deployedAt: item.at,
      windowHours: hours,
      before: gathered.before,
      after: gathered.after,
      newIssues: gathered.newIssues,
      regressions: regressed.length,
      goalName: goal?.name,
    });
  });
}
