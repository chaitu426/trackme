import { findProfiles, getDistinctIdsWithBehavior, type ProfileRow } from "@trackme/analytics";
import type { SegmentDefinition } from "./segment-schema";

/** Profiles examined per evaluation. A segment bigger than this reports "N+" instead of an exact count. */
export const SEGMENT_CANDIDATE_CAP = 1000;
export const SEGMENT_PREVIEW_ROWS = 50;

export interface SegmentResult {
  /** Matching profiles, newest activity first, trimmed to the preview size. */
  profiles: ProfileRow[];
  /** How many of the examined profiles match. */
  total: number;
  /** True when more profiles exist than were examined, so `total` is a lower bound. */
  capped: boolean;
}

/**
 * Who is in a segment. Profile conditions run in ClickHouse against the event-derived profile table
 * (traits, first/last seen, session and event counts); each behaviour condition then keeps or drops those
 * people based on what they did, also from ClickHouse. The caller must already have authorised access to
 * the site. (Name and email that a customer's backend set through POST /people are not part of the
 * conditions: segments see what the tracker sent.)
 */
export async function evaluateSegment(
  workspaceId: string,
  siteId: string,
  definition: SegmentDefinition
): Promise<SegmentResult> {
  let rows = await findProfiles({
    workspaceId,
    siteId,
    conditions: definition.conditions,
    match: definition.match,
    limit: SEGMENT_CANDIDATE_CAP,
  });
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
