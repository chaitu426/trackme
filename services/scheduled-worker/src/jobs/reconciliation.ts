import { getClickHouseClient } from "@trackme/analytics";

/** Pageviews must agree within 0.5 %, visitors within 2 % (uniqCombined64 is approximate). */
export const PAGEVIEW_TOLERANCE = 0.005;
export const VISITOR_TOLERANCE = 0.02;
/** More than this share of duplicate event ids in a day means dedupe is not holding. */
export const DUPLICATE_RATE_LIMIT = 0.001;

export interface DayTotals {
  pageviews: number;
  visitors: number;
}

export interface Mismatch {
  day: string;
  siteId: string;
  kind: "pageviews" | "visitors" | "missing_aggregate" | "missing_raw";
  aggregate: DayTotals | null;
  raw: DayTotals | null;
}

export interface ReconciliationClient {
  query(params: { query: string; query_params?: Record<string, unknown>; format: "JSONEachRow" }): Promise<{
    json<T>(): Promise<T[]>;
  }>;
}

const drift = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b, 1);

/**
 * Compares what the aggregate table says about a day with a fresh aggregate of the raw
 * events it was built from. A gap means a materialized view missed rows (a failed insert,
 * a migration run mid-traffic, a partial backfill). A gap of one or two units is ignored,
 * so a site with a handful of events does not page anyone.
 */
export function compareDay(
  day: string,
  aggregate: Map<string, DayTotals>,
  raw: Map<string, DayTotals>
): Mismatch[] {
  const out: Mismatch[] = [];
  for (const siteId of new Set([...aggregate.keys(), ...raw.keys()])) {
    const a = aggregate.get(siteId) ?? null;
    const r = raw.get(siteId) ?? null;
    if (!a) {
      out.push({ day, siteId, kind: "missing_aggregate", aggregate: a, raw: r });
    } else if (!r) {
      out.push({ day, siteId, kind: "missing_raw", aggregate: a, raw: r });
    } else {
      if (Math.abs(a.pageviews - r.pageviews) > 2 && drift(a.pageviews, r.pageviews) > PAGEVIEW_TOLERANCE) {
        out.push({ day, siteId, kind: "pageviews", aggregate: a, raw: r });
      }
      if (Math.abs(a.visitors - r.visitors) > 2 && drift(a.visitors, r.visitors) > VISITOR_TOLERANCE) {
        out.push({ day, siteId, kind: "visitors", aggregate: a, raw: r });
      }
    }
  }
  return out;
}

type Row = { site_id: string; pageviews: string | number; visitors: string | number };

const toMap = (rows: Row[]) =>
  new Map(rows.map((r) => [r.site_id, { pageviews: Number(r.pageviews), visitors: Number(r.visitors) }]));

export async function reconcileDay(client: ReconciliationClient, day: string): Promise<Mismatch[]> {
  const read = async (query: string) =>
    toMap(await (await client.query({ query, query_params: { day }, format: "JSONEachRow" })).json<Row>());

  const [aggregate, raw] = await Promise.all([
    read(`
      SELECT toString(site_id) AS site_id, sum(pageviews) AS pageviews, uniqCombined64Merge(visitors) AS visitors
      FROM site_daily_agg WHERE date = {day:Date} GROUP BY site_id`),
    read(`
      SELECT toString(site_id) AS site_id, countIf(type = 'pageview') AS pageviews, uniqExact(visitor_hash) AS visitors
      FROM events_v2 WHERE toDate(timestamp) = {day:Date} AND bot_status = 'human' GROUP BY site_id`),
  ]);
  return compareDay(day, aggregate, raw);
}

export interface DuplicateReport {
  day: string;
  total: number;
  duplicates: number;
  rate: number;
}

/** Share of events_v2 rows for the day whose event_id also appears elsewhere in the day. */
export async function duplicateRate(client: ReconciliationClient, day: string): Promise<DuplicateReport> {
  const rows = await (
    await client.query({
      query: `SELECT count() AS total, uniqExact(event_id) AS uniq FROM events_v2 WHERE toDate(timestamp) = {day:Date}`,
      query_params: { day },
      format: "JSONEachRow",
    })
  ).json<{ total: string | number; uniq: string | number }>();
  const total = Number(rows[0]?.total ?? 0);
  const duplicates = Math.max(0, total - Number(rows[0]?.uniq ?? 0));
  return { day, total, duplicates, rate: total > 0 ? duplicates / total : 0 };
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface ReconciliationResult {
  mismatches: Mismatch[];
  duplicates: DuplicateReport[];
  alerts: string[];
}

/**
 * Nightly check: yesterday (the freshest complete day) and the same weekday last week
 * (catches slow drift and late repairs), for aggregate drift and duplicate event ids.
 * Findings are returned and logged; the scheduler turns them into metrics and a failed
 * run, so an alert fires without anyone reading logs.
 */
export async function runReconciliation(
  deps: { client?: ReconciliationClient; now?: Date; log?: (line: string) => void } = {}
): Promise<ReconciliationResult> {
  const client = deps.client ?? (getClickHouseClient() as unknown as ReconciliationClient);
  const log = deps.log ?? ((line: string) => console.warn(line));
  const now = (deps.now ?? new Date()).getTime();
  const days = [isoDay(now - 86_400_000), isoDay(now - 7 * 86_400_000)];

  const mismatches: Mismatch[] = [];
  const duplicates: DuplicateReport[] = [];
  const alerts: string[] = [];

  for (const day of days) {
    const found = await reconcileDay(client, day);
    mismatches.push(...found);
    for (const m of found) {
      const line = `reconciliation ${m.day} site=${m.siteId} ${m.kind}: aggregate=${JSON.stringify(m.aggregate)} raw=${JSON.stringify(m.raw)}`;
      alerts.push(line);
      log(line);
    }

    const dup = await duplicateRate(client, day);
    duplicates.push(dup);
    if (dup.rate > DUPLICATE_RATE_LIMIT) {
      const line = `duplicate event ids ${day}: ${dup.duplicates} of ${dup.total} (${(dup.rate * 100).toFixed(3)} %)`;
      alerts.push(line);
      log(line);
    }
  }
  return { mismatches, duplicates, alerts };
}
