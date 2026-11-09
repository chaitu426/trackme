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

export interface SegmentDeps {
  findProfiles: typeof findProfiles;
  getDistinctIdsWithBehavior: typeof getDistinctIdsWithBehavior;
}
const realDeps: SegmentDeps = { findProfiles, getDistinctIdsWithBehavior };

/** Users a segment may resolve to when it feeds another report (retention). Past this the result is a lower bound. */
export const SEGMENT_USER_CAP = 20_000;

/**
 * Everyone who matches a definition, up to `cap`, newest activity first. Profile conditions run in ClickHouse against
 * the event-derived profile table (traits, first/last seen, session and event counts); each behaviour condition then
 * keeps or drops those people based on what they did, also from ClickHouse. `capped` says more people than `cap` were
 * candidates, so the match is incomplete. The caller must already have authorised access to the site. (Name and email
 * that a customer's backend set through POST /people are not part of the conditions: segments see what the tracker sent.)
 */
export async function matchSegment(
  workspaceId: string,
  siteId: string,
  definition: SegmentDefinition,
  cap: number,
  deps: SegmentDeps = realDeps
): Promise<{ rows: ProfileRow[]; capped: boolean }> {
  let rows = await deps.findProfiles({
    workspaceId,
    siteId,
    conditions: definition.conditions,
    match: definition.match,
    limit: cap,
  });
  const capped = rows.length === cap;

  for (const behavior of definition.behavior) {
    if (rows.length === 0) break;
    const did = new Set(
      await deps.getDistinctIdsWithBehavior({
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
  return { rows, capped };
}

/** A preview for the segment builder: the first rows and a count that is exact unless `capped`. */
export async function evaluateSegment(
  workspaceId: string,
  siteId: string,
  definition: SegmentDefinition
): Promise<SegmentResult> {
  const { rows, capped } = await matchSegment(workspaceId, siteId, definition, SEGMENT_CANDIDATE_CAP);
  return { profiles: rows.slice(0, SEGMENT_PREVIEW_ROWS), total: rows.length, capped };
}
