import { db, siteUserProfiles, and, or, desc, eq, sql, type SiteUserProfile } from "@trackme/db";
import { getDistinctIdsWithBehavior } from "@trackme/analytics";
import type { ProfileCondition, SegmentDefinition } from "./segment-schema";

/** Profiles examined per evaluation. A segment bigger than this reports "N+" instead of an exact count. */
export const SEGMENT_CANDIDATE_CAP = 1000;
export const SEGMENT_PREVIEW_ROWS = 50;

type SQL = ReturnType<typeof sql>;

const p = siteUserProfiles;

/** Escapes LIKE wildcards so a typed "50%" matches the text, not everything. */
const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const NUMERIC = "^-?[0-9]+(\\.[0-9]+)?$";

function traitNumber(key: string): SQL {
  // Only numeric-looking values convert, so one text trait can't fail the whole query.
  return sql`(CASE WHEN (${p.traits} ->> ${key}) ~ ${NUMERIC} THEN (${p.traits} ->> ${key})::numeric END)`;
}

/** One profile condition as a Postgres predicate. Every value is bound as a parameter. */
export function conditionSql(c: ProfileCondition): SQL {
  switch (c.field) {
    case "trait": {
      const text = sql`(${p.traits} ->> ${c.key})`;
      const value = c.value ?? "";
      switch (c.op) {
        case "eq":
          return sql`${text} = ${value}`;
        case "neq":
          return sql`${text} IS DISTINCT FROM ${value}`;
        case "contains":
          return sql`${text} ILIKE ${likePattern(value)}`;
        case "exists":
          return sql`jsonb_exists(${p.traits}, ${c.key})`;
        case "missing":
          return sql`NOT jsonb_exists(${p.traits}, ${c.key})`;
        case "gt":
          return sql`${traitNumber(c.key)} > ${Number(value)}`;
        case "lt":
          return sql`${traitNumber(c.key)} < ${Number(value)}`;
      }
      break;
    }
    case "lastSeen":
      return c.op === "within"
        ? sql`${p.lastSeenAt} >= now() - make_interval(days => ${c.days})`
        : sql`${p.lastSeenAt} < now() - make_interval(days => ${c.days})`;
    case "firstSeen":
      return c.op === "within"
        ? sql`${p.firstSeenAt} >= now() - make_interval(days => ${c.days})`
        : sql`${p.firstSeenAt} < now() - make_interval(days => ${c.days})`;
    case "sessions":
      return c.op === "gte" ? sql`${p.totalSessions} >= ${c.value}` : sql`${p.totalSessions} <= ${c.value}`;
    case "events":
      return c.op === "gte" ? sql`${p.totalEvents} >= ${c.value}` : sql`${p.totalEvents} <= ${c.value}`;
    case "email":
      if (c.op === "contains") return sql`${p.email} ILIKE ${likePattern(c.value ?? "")}`;
      return c.op === "exists" ? sql`(${p.email} IS NOT NULL AND ${p.email} <> '')` : sql`(${p.email} IS NULL OR ${p.email} = '')`;
  }
  throw new Error("Unsupported segment condition");
}

export interface SegmentResult {
  /** Matching profiles, newest activity first, trimmed to the preview size. */
  profiles: SiteUserProfile[];
  /** How many of the examined profiles match. */
  total: number;
  /** True when more profiles exist than were examined, so `total` is a lower bound. */
  capped: boolean;
}

/**
 * Who is in a segment. Profile conditions narrow the identified users in Postgres; each
 * behaviour condition then keeps or drops them based on what ClickHouse says they did.
 * The caller must already have authorised access to the site.
 */
export async function evaluateSegment(
  workspaceId: string,
  siteId: string,
  definition: SegmentDefinition
): Promise<SegmentResult> {
  const predicates = definition.conditions.map(conditionSql);
  const where =
    predicates.length === 0
      ? eq(p.siteId, siteId)
      : and(eq(p.siteId, siteId), definition.match === "any" ? or(...predicates) : and(...predicates));

  let rows = await db.select().from(p).where(where).orderBy(desc(p.lastSeenAt)).limit(SEGMENT_CANDIDATE_CAP);
  const capped = rows.length === SEGMENT_CANDIDATE_CAP;

  for (const behavior of definition.behavior) {
    if (rows.length === 0) break;
    const did = new Set(
      await getDistinctIdsWithBehavior({
        workspaceId,
        siteId,
        distinctIds: rows.map((r) => r.distinctId),
        kind: behavior.kind,
        target: behavior.target,
        days: behavior.days,
      })
    );
    rows = rows.filter((r) => (behavior.op === "did" ? did.has(r.distinctId) : !did.has(r.distinctId)));
  }

  return { profiles: rows.slice(0, SEGMENT_PREVIEW_ROWS), total: rows.length, capped };
}
