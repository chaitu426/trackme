import { getClickHouseClient } from "@trackme/analytics";
import type { AlertEvent } from "./alert-events.js";

export interface RecentGroup {
  siteId: string;
  groupId: string;
  title: string;
  release: string;
  level: string;
  firstSeenMs: number;
}

export interface NewGroupDeps {
  /** Issues first seen within the last `minutes` minutes. */
  fetchRecent(minutes: number): Promise<RecentGroup[]>;
  /** True the first time an issue is claimed. Keeps one event per issue however many runs see it. */
  claim(siteId: string, groupId: string): Promise<boolean>;
  publish(event: AlertEvent): Promise<void>;
  now?: Date;
}

/** Looks back further than the run interval so a missed run does not lose an issue; the claim stops repeats. */
export const LOOKBACK_MINUTES = 15;

/** Publishes one `new_error_group` event for each issue first seen recently. Returns how many it published. */
export async function publishNewErrorGroups(deps: NewGroupDeps): Promise<number> {
  const at = (deps.now ?? new Date()).toISOString();
  let published = 0;
  for (const g of await deps.fetchRecent(LOOKBACK_MINUTES)) {
    if (!(await deps.claim(g.siteId, g.groupId))) continue;
    await deps.publish({ type: "new_error_group", siteId: g.siteId, groupId: g.groupId, title: g.title, release: g.release, level: g.level, at });
    published += 1;
  }
  return published;
}

export function createClickHouseNewGroupFetch(client: Pick<ReturnType<typeof getClickHouseClient>, "query"> = getClickHouseClient()): NewGroupDeps["fetchRecent"] {
  return async (minutes) => {
    const rs = await client.query({
      query: `SELECT toString(site_id) AS s, toString(group_id) AS g, anyLast(title) AS ttl, argMinMerge(first_release) AS rel, anyLast(level) AS lvl,
                     toUnixTimestamp64Milli(min(first_seen)) AS fs
              FROM growth_analytics.error_groups
              WHERE last_seen >= now() - toIntervalMinute({minutes:UInt32})
              GROUP BY site_id, group_id
              HAVING min(first_seen) >= now() - toIntervalMinute({minutes:UInt32})`,
      query_params: { minutes },
      format: "JSONEachRow",
    });
    return (await rs.json<Record<string, string>>()).map((r) => ({ siteId: r.s!, groupId: r.g!, title: r.ttl ?? "", release: r.rel ?? "", level: r.lvl ?? "", firstSeenMs: Number(r.fs) }));
  };
}
