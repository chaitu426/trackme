import type { ClickHouseClient } from "@clickhouse/client";
import { getDashboardClickHouseClient } from "../client.js";
import { AnalyticsQueryError } from "../errors.js";
import { MAX_PAYMENT_DAYS, type DateRange } from "./payments.js";

/**
 * Payment Failure Doctor reads. They read payment_failure_class (one row per failed payment, written by the classifier job),
 * always for one site and a date range of at most 92 days, with FINAL so a payment classified twice counts once.
 * Money is integer minor units per currency and currencies are never added together. Every query binds {siteId}.
 */
type Client = Pick<ClickHouseClient, "query">;
type Params = Record<string, unknown>;

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkRange(r: DateRange): void {
  const days = (Date.parse(r.to) - Date.parse(r.from)) / DAY_MS + 1;
  if (!DATE.test(r.from) || !DATE.test(r.to) || !Number.isFinite(days) || days < 1 || days > MAX_PAYMENT_DAYS) {
    throw new AnalyticsQueryError(`A failures range must be between 1 and ${MAX_PAYMENT_DAYS} days`);
  }
}

async function run<T>(client: Client, query: string, params: Params): Promise<T[]> {
  try {
    return await (await client.query({ query, query_params: params, format: "JSONEachRow" })).json<T>();
  } catch (err) {
    throw new AnalyticsQueryError("ClickHouse payment failures query failed", { cause: err });
  }
}

const n = (v: unknown) => Number(v ?? 0);
const WHERE = `site_id = {siteId:UUID} AND toDate(failed_at) >= {from:Date} AND toDate(failed_at) <= {to:Date}`;

export interface CategoryRow {
  category: string;
  currency: string;
  count: number;
  valueMinor: number;
  /** Failures that also had an error in the same browser session just before. */
  withSessionError: number;
}

export interface CodeRow {
  category: string;
  code: string;
  count: number;
}

export interface FailureDay {
  day: string;
  currency: string;
  count: number;
  valueMinor: number;
}

export interface FailureOverview {
  categories: CategoryRow[];
  /** Top raw codes, at most five per category, most common first. */
  codes: CodeRow[];
  daily: FailureDay[];
  /** Failures in the range that have been classified, and how many of them stayed "unknown". */
  classified: number;
  unknown: number;
}

const TOP_CODES_PER_CATEGORY = 5;

export async function getFailureOverview(siteId: string, range: DateRange, client: Client = getDashboardClickHouseClient()): Promise<FailureOverview> {
  checkRange(range);
  const p: Params = { siteId, from: range.from, to: range.to };
  const [categories, codes, daily] = await Promise.all([
    run<Record<string, unknown>>(
      client,
      `SELECT category AS cat, currency AS cur, count() AS cnt, sum(amount_minor) AS value, countIf(session_error = 1) AS with_err
       FROM growth_analytics.payment_failure_class FINAL WHERE ${WHERE} GROUP BY cat, cur ORDER BY value DESC`,
      p
    ),
    run<Record<string, unknown>>(
      client,
      `SELECT category AS cat, failure_code_raw AS code_raw, count() AS cnt
       FROM growth_analytics.payment_failure_class FINAL WHERE ${WHERE} GROUP BY cat, code_raw ORDER BY cnt DESC LIMIT 400`,
      p
    ),
    run<Record<string, unknown>>(
      client,
      `SELECT toString(toDate(failed_at)) AS day_s, currency AS cur, count() AS cnt, sum(amount_minor) AS value
       FROM growth_analytics.payment_failure_class FINAL WHERE ${WHERE} GROUP BY day_s, cur ORDER BY day_s`,
      p
    ),
  ]);

  const perCategory = new Map<string, number>();
  const topCodes: CodeRow[] = [];
  for (const r of codes) {
    const category = String(r.cat);
    const seen = perCategory.get(category) ?? 0;
    if (seen >= TOP_CODES_PER_CATEGORY) continue;
    perCategory.set(category, seen + 1);
    topCodes.push({ category, code: String(r.code_raw) || "(no code)", count: n(r.cnt) });
  }
  const rows = categories.map((r): CategoryRow => ({ category: String(r.cat), currency: String(r.cur), count: n(r.cnt), valueMinor: n(r.value), withSessionError: n(r.with_err) }));
  return {
    categories: rows,
    codes: topCodes,
    daily: daily.map((r) => ({ day: String(r.day_s), currency: String(r.cur), count: n(r.cnt), valueMinor: n(r.value) })),
    classified: rows.reduce((s, r) => s + r.count, 0),
    unknown: rows.filter((r) => r.category === "unknown").reduce((s, r) => s + r.count, 0),
  };
}

export interface FailedPayment {
  paymentId: string;
  orderId: string;
  gateway: string;
  method: string;
  amountMinor: number;
  currency: string;
  code: string;
  category: string;
  ruleId: string;
  userRef: string;
  failedAt: string;
  sessionError: boolean;
}

export interface FailureListOptions {
  category?: string | undefined;
  currency?: string | undefined;
  limit?: number | undefined;
  /** Keyset cursor from the previous page: "<unix ms>|<payment id>". */
  cursor?: string | undefined;
}

export interface FailureList {
  rows: FailedPayment[];
  /** Pass back as `cursor` for the next page, or null at the end. */
  next: string | null;
}

const MAX_PAGE = 100;

/** Failed payments, newest first, by keyset pagination on (failed_at, payment_id) so a deep page costs the same as the first. */
export async function listFailures(siteId: string, range: DateRange, options: FailureListOptions = {}, client: Client = getDashboardClickHouseClient()): Promise<FailureList> {
  checkRange(range);
  const limit = Math.min(Math.max(1, options.limit ?? 25), MAX_PAGE);
  const p: Params = { siteId, from: range.from, to: range.to, limit: limit + 1 };
  let extra = "";
  if (options.category) {
    extra += " AND category = {category:String}";
    p.category = options.category;
  }
  if (options.currency) {
    extra += " AND currency = {currency:String}";
    p.currency = options.currency;
  }
  if (options.cursor) {
    const [ms, id] = options.cursor.split("|");
    if (!ms || !id || !/^\d{9,14}$/.test(ms)) throw new AnalyticsQueryError("The cursor is not valid");
    extra += " AND (toUnixTimestamp64Milli(failed_at), payment_id) < ({curMs:Int64}, {curId:String})";
    p.curMs = ms;
    p.curId = id;
  }
  const found = await run<Record<string, unknown>>(
    client,
    `SELECT payment_id AS pid, order_id AS ord, gateway AS gw, method AS mth, amount_minor AS amt, currency AS cur,
            failure_code_raw AS code_raw, category AS cat, rule_id AS rid, user_ref AS usr, session_error AS se,
            toUnixTimestamp64Milli(failed_at) AS ms
     FROM growth_analytics.payment_failure_class FINAL
     WHERE ${WHERE}${extra}
     ORDER BY ms DESC, pid DESC LIMIT {limit:UInt32}`,
    p
  );
  const page = found.slice(0, limit);
  const rows = page.map(
    (r): FailedPayment => ({
      paymentId: String(r.pid), orderId: String(r.ord), gateway: String(r.gw), method: String(r.mth), amountMinor: n(r.amt), currency: String(r.cur),
      code: String(r.code_raw), category: String(r.cat), ruleId: String(r.rid), userRef: String(r.usr), failedAt: new Date(n(r.ms)).toISOString(), sessionError: n(r.se) === 1,
    })
  );
  const last = page[page.length - 1];
  return { rows, next: found.length > limit && last ? `${n(last.ms)}|${String(last.pid)}` : null };
}
