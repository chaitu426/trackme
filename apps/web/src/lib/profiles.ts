import { db, siteUserProfiles, and, eq, inArray } from "@trackme/db";
import type { ProfileRow } from "@trackme/analytics";

/**
 * Profiles are built from the event stream (ClickHouse, see packages/analytics/src/queries/profiles.ts).
 * A customer's backend can also POST /people to attach a name, email or traits the browser never sees;
 * those live in Postgres (site_user_profiles) and are laid over the event-derived row for the same
 * distinct id: one indexed lookup for the page being shown, never a scan. A person who exists only in
 * Postgres (no tracked events yet) is not listed; there is nothing to show about their activity.
 */
export async function overlayServerProfiles(siteId: string, rows: ProfileRow[]): Promise<ProfileRow[]> {
  if (rows.length === 0) return rows;
  const overrides = await db
    .select()
    .from(siteUserProfiles)
    .where(and(eq(siteUserProfiles.siteId, siteId), inArray(siteUserProfiles.distinctId, rows.map((r) => r.distinctId))));
  const byId = new Map(overrides.map((o) => [o.distinctId, o]));
  return rows.map((row) => {
    const o = byId.get(row.distinctId);
    if (!o) return row;
    return {
      ...row,
      name: o.name ?? row.name,
      email: o.email ?? row.email,
      traits: { ...row.traits, ...((o.traits as Record<string, unknown>) ?? {}) },
    };
  });
}
