import { AnalyticsOverloadedError } from "./errors.js";

/**
 * Per-tenant concurrency gate for dashboard queries.
 *
 * Every tenant shares one ClickHouse user with a fixed number of query slots, so without a gate a
 * single workspace running heavy funnel or journey queries can occupy all of them and every other
 * workspace's dashboard queues or errors. Here each workspace may run `limit` queries at once on
 * this node; further ones wait (at most `maxWaiting` of them, for at most `maxWaitMs`) and anything
 * beyond that is refused at once, which the web layer reports as 429.
 *
 * When a query ends its slot is handed straight to the longest waiter, so waiting is FIFO per tenant
 * and a busy tenant cannot starve itself either. Limits are per node: with N web nodes a tenant can
 * hold at most N x limit slots, which the sizing in the ClickHouse profile must allow for.
 */
export function createTenantGate(limit: number, maxWaiting: number, maxWaitMs: number) {
  type Lane = { running: number; waiting: Array<() => void> };
  const lanes = new Map<string, Lane>();

  return async function run<T>(tenant: string, fn: () => Promise<T>): Promise<T> {
    let lane = lanes.get(tenant);
    if (!lane) lanes.set(tenant, (lane = { running: 0, waiting: [] }));
    const mine = lane;

    if (mine.running < limit) {
      mine.running++;
    } else {
      if (mine.waiting.length >= maxWaiting) throw new AnalyticsOverloadedError();
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          mine.waiting.splice(mine.waiting.indexOf(wake), 1);
          reject(new AnalyticsOverloadedError());
        }, maxWaitMs);
        mine.waiting.push(wake);
      });
    }

    try {
      return await fn();
    } finally {
      const next = mine.waiting.shift();
      if (next) next(); // the slot passes to the waiter; `running` stays as it is
      else if (--mine.running === 0) lanes.delete(tenant);
    }
  };
}

/** The tenant a ClickHouse query belongs to: every dashboard query binds {workspaceId:UUID}. */
export function tenantOf(params: { query_params?: Record<string, unknown> }): string {
  const id = params.query_params?.workspaceId;
  return typeof id === "string" ? id : "_none";
}
