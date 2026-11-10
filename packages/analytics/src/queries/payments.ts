import type { ClickHouseClient } from "@clickhouse/client";
import { getDashboardClickHouseClient } from "../client.js";
import { AnalyticsQueryError } from "../errors.js";
import { detectIncidents, type HealthBucket, type Incident } from "../payments-health.js";

/**
 * Payments & Revenue reads.
 *
 * payment_events is ordered (site_id, date, gateway, gateway_event_id) and is ReplacingMergeTree on the gateway's event id,
 * so every read here is scoped to one site and a date range (max 92 days) and uses FINAL: a redelivered notification that has
 * not been merged yet still counts once. A payment is judged by its whole history (captured wins over an earlier failed
 * attempt of the same payment id, a refund is a separate row), so each query first collapses events to one row per payment.
 *
 * Money is integer minor units per currency. Currencies are never summed together: every result is per currency.
 * Every query binds {siteId}; callers must have authorized the site for the workspace.
 */

type Client = Pick<ClickHouseClient, "query">;
type Params = Record<string, unknown>;

export const MAX_PAYMENT_DAYS = 92;
const DAY_MS = 86_400_000;

export interface DateRange {
  /** YYYY-MM-DD, UTC, inclusive. */
  from: string;
  to: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkRange(r: DateRange): void {
  const days = (Date.parse(r.to) - Date.parse(r.from)) / DAY_MS + 1;
  if (!DATE.test(r.from) || !DATE.test(r.to) || !Number.isFinite(days) || days < 1 || days > MAX_PAYMENT_DAYS) {
    throw new AnalyticsQueryError(`A payments range must be between 1 and ${MAX_PAYMENT_DAYS} days`);
  }
}

async function run<T>(client: Client, query: string, params: Params): Promise<T[]> {
  try {
    const rs = await client.query({ query, query_params: params, format: "JSONEachRow" });
    return await rs.json<T>();
  } catch (err) {
    throw new AnalyticsQueryError("ClickHouse payments query failed", { cause: err });
  }
}

const n = (v: unknown): number => Number(v ?? 0);
const rangeParams = (siteId: string, r: DateRange): Params => ({ siteId, from: r.from, to: r.to });

/** One row per payment (per currency) with the facts every metric below is built from. */
const PER_PAYMENT = `
  SELECT currency, gateway, payment_id,
         max(status = 'captured') AS paid,
         max(status = 'failed') AS failed,
         maxIf(amount_minor, status = 'captured') AS amount,
         sumIf(amount_minor, status = 'refunded') AS refunded,
         max(status = 'disputed') AS disputed,
         -- A refund or dispute event carries the method "other"; the payment's method is what it was when it was made.
         argMaxIf(method, created_at, status IN ('created', 'authorized', 'captured', 'failed')) AS method,
         toDate(min(created_at)) AS day,
         any(if(user_ref != '', user_ref, customer_ref)) AS customer
  FROM growth_analytics.payment_events FINAL
  WHERE site_id = {siteId:UUID} AND toDate(created_at) >= {from:Date} AND toDate(created_at) <= {to:Date}
  GROUP BY currency, gateway, payment_id`;

export interface CurrencySummary {
  currency: string;
  /** Captured payments, gross. */
  revenueMinor: number;
  refundedMinor: number;
  /** Payments that were captured. */
  paid: number;
  /** Distinct payments attempted (a payment id seen in any status). */
  attempts: number;
  /** Attempts that ended in failure and never succeeded. */
  failed: number;
  disputed: number;
  /** Distinct customers behind captured payments (user, else gateway customer; payments without either count once each). */
  payers: number;
}

export interface DailyPoint {
  day: string;
  currency: string;
  revenueMinor: number;
  paid: number;
  attempts: number;
}

export interface PaymentBreakdownRow {
  key: string;
  currency: string;
  attempts: number;
  paid: number;
  revenueMinor: number;
}

export interface PaymentsOverview {
  currencies: CurrencySummary[];
  daily: DailyPoint[];
  byMethod: PaymentBreakdownRow[];
  byGateway: PaymentBreakdownRow[];
}

export async function getPaymentsOverview(
  siteId: string,
  range: DateRange,
  client: Client = getDashboardClickHouseClient()
): Promise<PaymentsOverview> {
  checkRange(range);
  const p = rangeParams(siteId, range);

  const [summary, daily, byMethod, byGateway] = await Promise.all([
    run<Record<string, unknown>>(
      client,
      `SELECT currency, sum(amount * paid) AS revenue, sum(refunded) AS refunded_n, sum(paid) AS paid_n, count() AS attempts,
              countIf(failed = 1 AND paid = 0) AS failed_n, sum(disputed) AS disputed_n,
              uniqExactIf(if(customer != '', customer, payment_id), paid = 1) AS payers
       FROM (${PER_PAYMENT}) GROUP BY currency ORDER BY revenue DESC`,
      p
    ),
    run<Record<string, unknown>>(
      client,
      `SELECT toString(day) AS day_s, currency, sum(amount * paid) AS revenue, sum(paid) AS paid_n, count() AS attempts
       FROM (${PER_PAYMENT}) GROUP BY day, currency ORDER BY day`,
      p
    ),
    run<Record<string, unknown>>(
      client,
      `SELECT method AS k, currency, count() AS attempts, sum(paid) AS paid_n, sum(amount * paid) AS revenue
       FROM (${PER_PAYMENT}) GROUP BY k, currency ORDER BY attempts DESC`,
      p
    ),
    run<Record<string, unknown>>(
      client,
      `SELECT gateway AS k, currency, count() AS attempts, sum(paid) AS paid_n, sum(amount * paid) AS revenue
       FROM (${PER_PAYMENT}) GROUP BY k, currency ORDER BY attempts DESC`,
      p
    ),
  ]);

  const breakdown = (rows: Array<Record<string, unknown>>): PaymentBreakdownRow[] =>
    rows.map((r) => ({ key: String(r.k), currency: String(r.currency), attempts: n(r.attempts), paid: n(r.paid_n), revenueMinor: n(r.revenue) }));

  return {
    currencies: summary.map((r) => ({
      currency: String(r.currency),
      revenueMinor: n(r.revenue),
      refundedMinor: n(r.refunded_n),
      paid: n(r.paid_n),
      attempts: n(r.attempts),
      failed: n(r.failed_n),
      disputed: n(r.disputed_n),
      payers: n(r.payers),
    })),
    daily: daily.map((r) => ({ day: String(r.day_s), currency: String(r.currency), revenueMinor: n(r.revenue), paid: n(r.paid_n), attempts: n(r.attempts) })),
    byMethod: breakdown(byMethod),
    byGateway: breakdown(byGateway),
  };
}

/* ───────────────────────────── checkout funnel ───────────────────────────── */

export interface FunnelCounts {
  viewed: number;
  started: number;
  reached: number;
  paid: number;
}

export interface CheckoutFunnel extends FunnelCounts {
  byBrowser: Array<{ key: string } & FunnelCounts>;
  byDevice: Array<{ key: string } & FunnelCounts>;
}

export const MAX_FUNNEL_DAYS = 31;

/**
 * Sessions that viewed the checkout page, how many of them started a payment (trackPayment with an order id), how many of
 * those orders reached the gateway (any notification arrived) and how many were paid. All four are sessions, so the steps
 * are comparable. The browser and device come from the checkout pageview, which is what makes "Safari converts at half the
 * rate" visible. Reads raw pageviews, so the range is capped at 31 days.
 */
export async function getCheckoutFunnel(
  siteId: string,
  range: DateRange,
  checkoutPath = "/checkout",
  client: Client = getDashboardClickHouseClient()
): Promise<CheckoutFunnel> {
  checkRange(range);
  if ((Date.parse(range.to) - Date.parse(range.from)) / DAY_MS + 1 > MAX_FUNNEL_DAYS) {
    throw new AnalyticsQueryError(`The checkout funnel reads raw pageviews, so its range is at most ${MAX_FUNNEL_DAYS} days`);
  }
  const rows = await run<Record<string, unknown>>(
    client,
    `WITH viewers AS (
       SELECT session_hash, any(browser) AS browser, any(device) AS device
       FROM growth_analytics.events_v2
       WHERE site_id = {siteId:UUID} AND toDate(timestamp) >= {from:Date} AND toDate(timestamp) <= {to:Date}
         AND type = 'pageview' AND bot_status = 'human' AND path = {path:String}
       GROUP BY session_hash
     ),
     orders AS (
       SELECT session_hash, order_id FROM growth_analytics.order_session FINAL
       WHERE site_id = {siteId:UUID} AND toDate(ts) >= {from:Date} AND toDate(ts) <= {to:Date}
     ),
     pay AS (
       SELECT order_id, max(status = 'captured') AS paid
       FROM growth_analytics.payment_events FINAL
       WHERE site_id = {siteId:UUID} AND toDate(created_at) >= {from:Date} AND toDate(created_at) <= addDays({to:Date}, 1)
       GROUP BY order_id
     )
     SELECT browser, device, count() AS viewed, sum(started) AS started_n, sum(reached) AS reached_n, sum(paid_s) AS paid_n
     FROM (
       SELECT v.session_hash AS session_hash, v.browser AS browser, v.device AS device,
              max(o.order_id != '') AS started, max(p.order_id != '') AS reached, max(p.paid) AS paid_s
       FROM viewers v
       LEFT JOIN orders o ON o.session_hash = v.session_hash
       LEFT JOIN pay p ON p.order_id = o.order_id
       GROUP BY v.session_hash, v.browser, v.device
     )
     GROUP BY browser, device`,
    { ...rangeParams(siteId, range), path: checkoutPath }
  );

  const total: FunnelCounts = { viewed: 0, started: 0, reached: 0, paid: 0 };
  const browser = new Map<string, FunnelCounts>();
  const device = new Map<string, FunnelCounts>();
  const add = (m: Map<string, FunnelCounts>, k: string, c: FunnelCounts) => {
    const cur = m.get(k) ?? { viewed: 0, started: 0, reached: 0, paid: 0 };
    cur.viewed += c.viewed; cur.started += c.started; cur.reached += c.reached; cur.paid += c.paid;
    m.set(k, cur);
  };
  for (const r of rows) {
    const c: FunnelCounts = { viewed: n(r.viewed), started: n(r.started_n), reached: n(r.reached_n), paid: n(r.paid_n) };
    total.viewed += c.viewed; total.started += c.started; total.reached += c.reached; total.paid += c.paid;
    add(browser, String(r.browser) || "Unknown", c);
    add(device, String(r.device) || "Unknown", c);
  }
  const list = (m: Map<string, FunnelCounts>) =>
    [...m].map(([key, c]) => ({ key, ...c })).sort((a, b) => b.viewed - a.viewed);
  return { ...total, byBrowser: list(browser), byDevice: list(device) };
}

/* ───────────────────────────── gateway health ───────────────────────────── */

export const BUCKET_MINUTES = 5;
const HEALTH_DAYS = 7;

export interface GatewayWindow {
  /** Payments that ended in success or failure in the window. */
  outcomes: number;
  paid: number;
  /** null when there were too few outcomes to say anything. */
  successRate: number | null;
}

export interface GatewayHealth {
  gateway: string;
  lastEventAt: string | null;
  last5m: GatewayWindow;
  last1h: GatewayWindow;
  last24h: GatewayWindow;
  /** Success rate over the 7 days before the current hour, the yardstick for "is this unusual". */
  baseline: number | null;
  /** Newest first. An incident still running has `ongoing: true`. */
  incidents: Incident[];
  /** The last 6 hours in 5-minute buckets, oldest first, empty buckets included, for the health strip. */
  recent: Array<{ startMs: number; paid: number; failed: number }>;
}

const STRIP_BUCKETS = 72;

function recentBuckets(buckets: HealthBucket[], nowMs: number): GatewayHealth["recent"] {
  const size = BUCKET_MINUTES * 60_000;
  const last = Math.floor(nowMs / size) * size;
  const byStart = new Map(buckets.map((b) => [b.startMs, b]));
  return Array.from({ length: STRIP_BUCKETS }, (_, i) => {
    const startMs = last - (STRIP_BUCKETS - 1 - i) * size;
    const b = byStart.get(startMs);
    return { startMs, paid: b?.paid ?? 0, failed: b?.failed ?? 0 };
  });
}

const window = (buckets: HealthBucket[], sinceMs: number): GatewayWindow => {
  let paid = 0, outcomes = 0;
  for (const b of buckets) {
    if (b.startMs >= sinceMs) { paid += b.paid; outcomes += b.paid + b.failed; }
  }
  return { outcomes, paid, successRate: outcomes >= 5 ? paid / outcomes : null };
};

/**
 * Per gateway: success rate over the last 5 minutes, hour and day, against the gateway's own 7-day norm, plus incidents
 * (stretches of 5-minute buckets where the success rate fell well below that norm). One query over 7 days of final
 * payment outcomes, bucketed by 5 minutes; everything else is computed here.
 */
export async function getGatewayHealth(
  siteId: string,
  now: Date = new Date(),
  client: Client = getDashboardClickHouseClient()
): Promise<GatewayHealth[]> {
  const sinceMs = now.getTime() - HEALTH_DAYS * DAY_MS;
  const rows = await run<Record<string, unknown>>(
    client,
    `SELECT gateway, toUnixTimestamp(toStartOfInterval(ts, INTERVAL ${BUCKET_MINUTES} MINUTE)) AS bucket,
            sum(paid) AS paid_n, sum(failed) AS failed_n, topKIf(1)(failure_code, failed = 1) AS top
     FROM (
       SELECT gateway, payment_id,
              max(status = 'captured') AS paid,
              if(max(status = 'captured') = 0 AND max(status = 'failed') = 1, 1, 0) AS failed,
              maxIf(created_at, status IN ('captured', 'failed')) AS ts,
              argMaxIf(failure_code_raw, created_at, status = 'failed') AS failure_code
       FROM growth_analytics.payment_events FINAL
       WHERE site_id = {siteId:UUID} AND created_at >= fromUnixTimestamp64Milli({since:Int64}, 'UTC')
       GROUP BY gateway, payment_id
       HAVING max(status IN ('captured', 'failed')) = 1
     )
     GROUP BY gateway, bucket ORDER BY gateway, bucket`,
    { siteId, since: sinceMs }
  );
  const last = await run<{ gateway: string; at: string }>(
    client,
    `SELECT gateway, toString(max(created_at)) AS at FROM growth_analytics.payment_events
     WHERE site_id = {siteId:UUID} AND toDate(created_at) >= toDate({since:Int64} / 1000) GROUP BY gateway`,
    { siteId, since: sinceMs }
  );

  const byGateway = new Map<string, HealthBucket[]>();
  for (const r of rows) {
    const list = byGateway.get(String(r.gateway)) ?? [];
    const top = Array.isArray(r.top) ? String(r.top[0] ?? "") : "";
    list.push({ startMs: n(r.bucket) * 1000, paid: n(r.paid_n), failed: n(r.failed_n), topFailure: top });
    byGateway.set(String(r.gateway), list);
  }
  const lastAt = new Map(last.map((l) => [l.gateway, l.at.replace(" ", "T") + "Z"]));

  const nowMs = now.getTime();
  const hourAgo = nowMs - 3_600_000;
  return [...byGateway.entries()].map(([gateway, buckets]) => {
    const incidents = detectIncidents(buckets, nowMs);
    // The norm is what the gateway does when it is not in an incident, so an outage does not lower its own yardstick.
    const history = buckets.filter((b) => b.startMs < hourAgo && !incidents.some((i) => b.startMs >= i.startMs && b.startMs < i.endMs));
    const paid = history.reduce((s, b) => s + b.paid, 0);
    const all = history.reduce((s, b) => s + b.paid + b.failed, 0);
    return {
      gateway,
      lastEventAt: lastAt.get(gateway) ?? null,
      last5m: window(buckets, nowMs - 300_000),
      last1h: window(buckets, hourAgo),
      last24h: window(buckets, nowMs - DAY_MS),
      baseline: all >= 20 ? paid / all : null,
      incidents: [...incidents].reverse(),
      recent: recentBuckets(buckets, nowMs),
    };
  });
}
