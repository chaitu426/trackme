import type { ClickHouseClient } from "@clickhouse/client";
import { getDashboardClickHouseClient } from "../client.js";
import { AnalyticsQueryError } from "../errors.js";
import { MAX_PAYMENT_DAYS, type DateRange } from "./payments.js";

/**
 * Failed-payment recovery, and refunds and disputes. Everything is for one site and a date range of at most 92 days, uses FINAL on
 * ReplacingMergeTree tables, and keeps currencies apart. Every query binds {siteId}.
 *
 * A failed payment is "recovered" when the same order, or the same identified customer, has a captured payment after the
 * failure: within 24 hours, or within 72 hours. Order is checked first and customer second; a payment recovered both ways counts once.
 * Payments with neither an order id nor a customer reference cannot be followed and count as not recovered.
 */
type Client = Pick<ClickHouseClient, "query">;
type Params = Record<string, unknown>;
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RECOVERY_HOURS = 72;

function checkRange(r: DateRange): void {
  const days = (Date.parse(r.to) - Date.parse(r.from)) / DAY_MS + 1;
  if (!DATE.test(r.from) || !DATE.test(r.to) || !Number.isFinite(days) || days < 1 || days > MAX_PAYMENT_DAYS) {
    throw new AnalyticsQueryError(`A range must be between 1 and ${MAX_PAYMENT_DAYS} days`);
  }
}

async function run<T>(client: Client, query: string, params: Params): Promise<T[]> {
  try {
    return await (await client.query({ query, query_params: params, format: "JSONEachRow" })).json<T>();
  } catch (err) {
    throw new AnalyticsQueryError("ClickHouse payment recovery query failed", { cause: err });
  }
}
const n = (v: unknown) => Number(v ?? 0);

/** The earlier of two recovery delays (seconds); either may be missing. */
export function earlierDelay(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

export interface RecoveryRow {
  category: string;
  currency: string;
  failed: number;
  valueMinor: number;
  recovered24: number;
  recovered72: number;
  recoveredValue72Minor: number;
}

export interface RecoveryThrough {
  method: string;
  currency: string;
  count: number;
  valueMinor: number;
}

export interface Recovery {
  rows: RecoveryRow[];
  /** How the customers who came back paid, which is often not how they first tried. */
  through: RecoveryThrough[];
}

const FAILED = `site_id = {siteId:UUID} AND toDate(failed_at) >= {from:Date} AND toDate(failed_at) <= {to:Date}`;

/** For one way of following a customer (the order, or the customer reference), each failure's earliest later capture. */
const followBy = (column: "order_id" | "user_ref") => `
  SELECT f.pid AS pid, any(f.cat) AS cat, any(f.amt) AS amt, any(f.cur) AS cur,
         min(dateDiff('second', f.failed_at, c.cap_at)) AS delay,
         argMin(c.cmethod, c.cap_at) AS rec_method
  FROM (SELECT site_id, payment_id AS pid, category AS cat, amount_minor AS amt, currency AS cur, ${column}, failed_at
        FROM growth_analytics.payment_failure_class FINAL WHERE ${FAILED} AND ${column} != '') AS f
  INNER JOIN (
    SELECT site_id, ${column}, payment_id, min(created_at) AS cap_at, argMin(method, created_at) AS cmethod
    FROM growth_analytics.payment_events FINAL
    WHERE site_id = {siteId:UUID} AND status = 'captured' AND ${column} != ''
      AND toDate(created_at) >= {from:Date} AND toDate(created_at) <= addDays({to:Date}, 4)
    GROUP BY site_id, ${column}, payment_id
  ) AS c ON f.site_id = c.site_id AND f.${column} = c.${column}
  WHERE c.cap_at > f.failed_at AND c.cap_at <= f.failed_at + toIntervalHour(${RECOVERY_HOURS})
  GROUP BY pid`;

export async function getRecovery(siteId: string, range: DateRange, client: Client = getDashboardClickHouseClient()): Promise<Recovery> {
  checkRange(range);
  const p: Params = { siteId, from: range.from, to: range.to };
  const [failed, byOrder, byUser] = await Promise.all([
    run<Record<string, unknown>>(client, `SELECT category AS cat, currency AS cur, count() AS cnt, sum(amount_minor) AS value FROM growth_analytics.payment_failure_class FINAL WHERE ${FAILED} GROUP BY cat, cur`, p),
    run<Record<string, unknown>>(client, followBy("order_id"), p),
    run<Record<string, unknown>>(client, followBy("user_ref"), p),
  ]);

  const best = new Map<string, { cat: string; cur: string; amt: number; delay: number; method: string }>();
  for (const r of [...byOrder, ...byUser]) {
    const pid = String(r.pid);
    const delay = earlierDelay(best.get(pid)?.delay, n(r.delay))!;
    const prev = best.get(pid);
    best.set(pid, { cat: String(r.cat), cur: String(r.cur), amt: n(r.amt), delay, method: !prev || n(r.delay) < prev.delay ? String(r.rec_method) : prev.method });
  }

  const rows = new Map<string, RecoveryRow>();
  for (const r of failed) {
    rows.set(`${r.cat}|${r.cur}`, { category: String(r.cat), currency: String(r.cur), failed: n(r.cnt), valueMinor: n(r.value), recovered24: 0, recovered72: 0, recoveredValue72Minor: 0 });
  }
  const through = new Map<string, RecoveryThrough>();
  for (const b of best.values()) {
    const row = rows.get(`${b.cat}|${b.cur}`);
    if (!row) continue;
    row.recovered72 += 1;
    row.recoveredValue72Minor += b.amt;
    if (b.delay <= 24 * 3600) row.recovered24 += 1;
    const t = through.get(`${b.method}|${b.cur}`) ?? { method: b.method, currency: b.cur, count: 0, valueMinor: 0 };
    t.count += 1;
    t.valueMinor += b.amt;
    through.set(`${b.method}|${b.cur}`, t);
  }
  return { rows: [...rows.values()].sort((a, b) => b.valueMinor - a.valueMinor), through: [...through.values()].sort((a, b) => b.count - a.count) };
}

/* ───────────────────────────── refunds and disputes ───────────────────────────── */

export interface RefundDisputeRow {
  kind: "refunded" | "disputed";
  paymentId: string;
  orderId: string;
  userRef: string;
  gateway: string;
  method: string;
  amountMinor: number;
  currency: string;
  reason: string;
  at: string;
  /** For a dispute, the respond-by time, or null when the gateway gave none. */
  dueBy: string | null;
}

export interface RefundDisputeSummary {
  currency: string;
  refundedCount: number;
  refundedMinor: number;
  disputedCount: number;
  disputedMinor: number;
  /** Captured value in the same range, the base for the rates. */
  capturedMinor: number;
  capturedCount: number;
}

export interface RefundsAndDisputes {
  summary: RefundDisputeSummary[];
  rows: RefundDisputeRow[];
  /** Reasons, most common first. */
  reasons: Array<{ kind: "refunded" | "disputed"; reason: string; count: number }>;
}

const MAX_ROWS = 100;
/** The original payment of a refund can be older than the range; look back this far to find its order and customer. */
const LOOKBACK_DAYS = 120;

export async function getRefundsAndDisputes(siteId: string, range: DateRange, client: Client = getDashboardClickHouseClient()): Promise<RefundsAndDisputes> {
  checkRange(range);
  const p: Params = { siteId, from: range.from, to: range.to, back: LOOKBACK_DAYS, limit: MAX_ROWS };
  const IN_RANGE = `site_id = {siteId:UUID} AND toDate(created_at) >= {from:Date} AND toDate(created_at) <= {to:Date}`;
  const [summary, rows, reasons] = await Promise.all([
    run<Record<string, unknown>>(
      client,
      `SELECT currency AS cur,
              countIf(status = 'refunded') AS rc, sumIf(amount_minor, status = 'refunded') AS rv,
              countIf(status = 'disputed') AS dc, sumIf(amount_minor, status = 'disputed') AS dv,
              countIf(status = 'captured') AS cc, sumIf(amount_minor, status = 'captured') AS cv
       FROM growth_analytics.payment_events FINAL WHERE ${IN_RANGE} GROUP BY cur`,
      p
    ),
    run<Record<string, unknown>>(
      client,
      `SELECT r.status AS kind, r.payment_id AS pid, r.gateway AS gw, r.currency AS cur, r.amount_minor AS amt, r.reason AS why,
              toUnixTimestamp64Milli(r.created_at) AS at_ms, toUnixTimestamp64Milli(r.due_by) AS due_ms,
              p.ord AS ord, p.usr AS usr, p.mth AS mth
       FROM (SELECT site_id, status, payment_id, gateway, currency, amount_minor, reason, due_by, created_at
             FROM growth_analytics.payment_events FINAL WHERE ${IN_RANGE} AND status IN ('refunded', 'disputed')) AS r
       LEFT JOIN (
         SELECT site_id, payment_id,
                argMaxIf(order_id, created_at, order_id != '') AS ord,
                argMaxIf(user_ref, created_at, user_ref != '') AS usr,
                argMaxIf(method, created_at, status IN ('created', 'authorized', 'captured', 'failed')) AS mth
         FROM growth_analytics.payment_events FINAL
         WHERE site_id = {siteId:UUID} AND toDate(created_at) >= subtractDays({from:Date}, {back:UInt32})
         GROUP BY site_id, payment_id
       ) AS p ON r.site_id = p.site_id AND r.payment_id = p.payment_id
       ORDER BY at_ms DESC LIMIT {limit:UInt32}`,
      p
    ),
    run<Record<string, unknown>>(
      client,
      `SELECT status AS kind, if(reason = '', '(no reason given)', reason) AS why, count() AS cnt
       FROM growth_analytics.payment_events FINAL WHERE ${IN_RANGE} AND status IN ('refunded', 'disputed') GROUP BY kind, why ORDER BY cnt DESC LIMIT 20`,
      p
    ),
  ]);
  return {
    summary: summary.map((r) => ({ currency: String(r.cur), refundedCount: n(r.rc), refundedMinor: n(r.rv), disputedCount: n(r.dc), disputedMinor: n(r.dv), capturedCount: n(r.cc), capturedMinor: n(r.cv) })),
    rows: rows.map((r): RefundDisputeRow => ({
      kind: String(r.kind) === "disputed" ? "disputed" : "refunded", paymentId: String(r.pid), orderId: String(r.ord ?? ""), userRef: String(r.usr ?? ""),
      gateway: String(r.gw), method: String(r.mth ?? "other"), amountMinor: n(r.amt), currency: String(r.cur), reason: String(r.why), at: new Date(n(r.at_ms)).toISOString(),
      dueBy: n(r.due_ms) > 0 ? new Date(n(r.due_ms)).toISOString() : null,
    })),
    reasons: reasons.map((r) => ({ kind: String(r.kind) === "disputed" ? "disputed" : "refunded", reason: String(r.why), count: n(r.cnt) })),
  };
}

/** Whole days left until a dispute deadline (negative once passed), or null when there is no deadline. */
export function daysUntil(dueBy: string | null, now: Date = new Date()): number | null {
  if (!dueBy) return null;
  return Math.ceil((Date.parse(dueBy) - now.getTime()) / DAY_MS);
}
