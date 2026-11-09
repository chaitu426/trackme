import { getClickHouseClient } from "@trackme/analytics";

type Client = Pick<ReturnType<typeof getClickHouseClient>, "command">;

/** Errors from this long before the checkout page opened still count as part of the same trip to checkout. */
export const ERROR_LEAD_MINUTES = 10;
export const DEFAULT_CHECKOUT_PATH = "/checkout";

/**
 * One day of leak_sessions: every human session that opened the checkout page, whether it paid and for how much (through the
 * orders the browser reported), and the error groups it saw from ten minutes before it opened the page. Reads only that day's
 * rows (events and errors are partitioned and ordered by day) and the orders and payments around it. Replace-by-key, so running
 * a day again is safe.
 */
export const LEAK_DAY_SQL = `
INSERT INTO growth_analytics.leak_sessions (workspace_id, site_id, day, session_hash, paid, amount_minor, currency, error_groups)
SELECT any(c.wk), c.st, {day:Date}, c.sh,
       max(o.paid), max(o.amt), anyIf(o.cur, o.cur != ''),
       groupUniqArrayIf(e.gid, e.gid != 0 AND e.ets >= c.co_at - toIntervalMinute(${ERROR_LEAD_MINUTES}))
FROM (
  SELECT any(workspace_id) AS wk, site_id AS st, session_hash AS sh, min(timestamp) AS co_at
  FROM growth_analytics.events_v2
  WHERE toDate(timestamp) = {day:Date} AND type = 'pageview' AND bot_status = 'human' AND path = {checkout:String}
  GROUP BY site_id, session_hash
) AS c
LEFT JOIN (
  SELECT os.site_id AS st, os.session_hash AS sh, max(p.was_paid) AS paid, max(p.amount) AS amt, any(p.currency) AS cur
  FROM (SELECT site_id, order_id, session_hash FROM growth_analytics.order_session FINAL WHERE toDate(ts) = {day:Date}) AS os
  INNER JOIN (
    SELECT site_id, order_id, max(status = 'captured') AS was_paid, maxIf(amount_minor, status = 'captured') AS amount, any(currency) AS currency
    FROM growth_analytics.payment_events FINAL
    WHERE toDate(created_at) >= {day:Date} AND toDate(created_at) <= addDays({day:Date}, 1) AND order_id != ''
    GROUP BY site_id, order_id
  ) AS p ON os.site_id = p.site_id AND os.order_id = p.order_id
  GROUP BY os.site_id, os.session_hash
) AS o ON c.st = o.st AND c.sh = o.sh
LEFT JOIN (
  SELECT site_id AS st, session_hash AS sh, group_id AS gid, ts AS ets
  FROM growth_analytics.error_events
  WHERE toDate(ts) = {day:Date}
) AS e ON c.st = e.st AND c.sh = e.sh
GROUP BY c.st, c.sh`;

const dayString = (d: Date) => d.toISOString().slice(0, 10);

/** The days to recompute: today and the days before it. Events and payments can arrive a little late, so yesterday is redone too. */
export function leakDays(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) => dayString(new Date(now.getTime() - i * 86_400_000))).reverse();
}

export async function runRevenueLeakRollup(
  client: Client = getClickHouseClient(),
  options: { days?: number; now?: Date; checkoutPath?: string } = {}
): Promise<number> {
  const days = leakDays(options.now ?? new Date(), options.days ?? 2);
  for (const day of days) {
    await client.command({ query: LEAK_DAY_SQL, query_params: { day, checkout: options.checkoutPath ?? process.env.CHECKOUT_PATH ?? DEFAULT_CHECKOUT_PATH } });
  }
  return days.length;
}
