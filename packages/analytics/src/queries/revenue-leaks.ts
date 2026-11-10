import type { ClickHouseClient } from "@clickhouse/client";
import { getDashboardClickHouseClient } from "../client.js";
import { AnalyticsQueryError } from "../errors.js";
import { estimateLeak, MIN_AFFECTED, type Confidence } from "../revenue-leak.js";
import { MAX_PAYMENT_DAYS, type DateRange } from "./payments.js";

/**
 * Revenue Leaks: error groups ranked by what they cost at checkout. Reads leak_sessions (one row per checkout session, built by an
 * hourly job), so it never scans raw events. See revenue-leak.ts for how the two figures are computed and when none is published.
 * Every query binds {siteId}; the range is at most 92 days.
 */
type Client = Pick<ClickHouseClient, "query">;
type Params = Record<string, unknown>;
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ISSUES = 50;

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
    throw new AnalyticsQueryError("ClickHouse revenue leaks query failed", { cause: err });
  }
}
const n = (v: unknown) => Number(v ?? 0);

export interface LeakIssue {
  /** The error group id, as the decimal string the Errors pages use. */
  groupId: string;
  title: string;
  etype: string;
  affected: number;
  affectedPaid: number;
  affectedConversion: number;
  controlConversion: number;
  /** Null when there were too few sessions to publish a figure. */
  associatedLossMinor: number | null;
  incrementalLossMinor: number | null;
  confidence: Confidence;
  /** True when the issue has at least the minimum sessions and the figures are published. */
  enough: boolean;
}

export interface RevenueLeaks {
  /** Checkout sessions in the range and how many paid. */
  sessions: number;
  paid: number;
  conversion: number;
  /** The currency the money is shown in: the one most paid sessions used. Other currencies are counted as paid sessions but not valued. */
  currency: string;
  aovMinor: number;
  issues: LeakIssue[];
  /** Sessions that saw at least one error, for context. */
  sessionsWithErrors: number;
}

const WHERE = `site_id = {siteId:UUID} AND day >= {from:Date} AND day <= {to:Date}`;

export async function getRevenueLeaks(siteId: string, range: DateRange, client: Client = getDashboardClickHouseClient()): Promise<RevenueLeaks> {
  checkRange(range);
  const p: Params = { siteId, from: range.from, to: range.to };
  const [totals, currencies, groups] = await Promise.all([
    run<Record<string, unknown>>(client, `SELECT count() AS total, countIf(paid = 1) AS paid_n, countIf(length(error_groups) > 0) AS with_err FROM growth_analytics.leak_sessions FINAL WHERE ${WHERE}`, p),
    run<Record<string, unknown>>(client, `SELECT currency AS cur, count() AS paid_n, avg(amount_minor) AS avg_amt FROM growth_analytics.leak_sessions FINAL WHERE ${WHERE} AND paid = 1 AND currency != '' GROUP BY cur ORDER BY paid_n DESC LIMIT 1`, p),
    run<Record<string, unknown>>(client, `SELECT toString(g) AS gid, count() AS affected, countIf(paid = 1) AS affected_paid FROM growth_analytics.leak_sessions FINAL ARRAY JOIN error_groups AS g WHERE ${WHERE} GROUP BY g ORDER BY affected DESC LIMIT 200`, p),
  ]);
  const total = n(totals[0]?.total);
  const paid = n(totals[0]?.paid_n);
  const currency = String(currencies[0]?.cur ?? "");
  const aov = Math.round(n(currencies[0]?.avg_amt));

  const titles = groups.length === 0 ? [] : await run<Record<string, unknown>>(client, `SELECT toString(group_id) AS gid, anyLast(title) AS title, anyLast(etype) AS etype FROM growth_analytics.error_groups WHERE site_id = {siteId:UUID} AND group_id IN (SELECT arrayJoin(arrayMap(x -> toUInt64(x), {ids:Array(String)}))) GROUP BY group_id`, { siteId, ids: groups.map((g) => String(g.gid)) });
  const titleOf = new Map(titles.map((t) => [String(t.gid), { title: String(t.title), etype: String(t.etype) }]));

  const issues = groups.map((g): LeakIssue => {
    const affected = n(g.affected);
    const affectedPaid = n(g.affected_paid);
    const e = estimateLeak({ total, totalPaid: paid, affected, affectedPaid, aovMinor: aov });
    const meta = titleOf.get(String(g.gid));
    return {
      groupId: String(g.gid),
      title: meta?.title || `Issue ${String(g.gid).slice(0, 8)}`,
      etype: meta?.etype ?? "",
      affected,
      affectedPaid,
      affectedConversion: e.affectedConversion,
      controlConversion: e.controlConversion,
      associatedLossMinor: e.enough ? e.associatedLossMinor : null,
      incrementalLossMinor: e.enough ? e.incrementalLossMinor : null,
      confidence: e.confidence,
      enough: e.enough,
    };
  });
  // Published figures first, biggest estimated cost first; issues still collecting data after them, by how many sessions they have.
  issues.sort((a, b) => Number(b.enough) - Number(a.enough) || (b.incrementalLossMinor ?? 0) - (a.incrementalLossMinor ?? 0) || (b.associatedLossMinor ?? 0) - (a.associatedLossMinor ?? 0) || b.affected - a.affected);

  return { sessions: total, paid, conversion: total > 0 ? paid / total : 0, currency, aovMinor: aov, issues: issues.slice(0, MAX_ISSUES), sessionsWithErrors: n(totals[0]?.with_err) };
}

/** The ranked list as CSV, every field quoted so a title with a comma or a quote stays one cell, and no cell can start a spreadsheet formula. */
export function leaksToCsv(data: RevenueLeaks): string {
  const cell = (v: string | number) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  const head = ["Issue", "Type", "Sessions with it", "Of them paid", "Conversion with it", "Conversion without it", "Estimated cost, upper bound", "Estimated cost, beyond normal drop-off", "Confidence", "Enough data", "Currency", "Issue id"];
  const rows = data.issues.map((i) => [
    i.title, i.etype, i.affected, i.affectedPaid, (i.affectedConversion * 100).toFixed(1) + "%", (i.controlConversion * 100).toFixed(1) + "%",
    i.associatedLossMinor === null ? "" : (i.associatedLossMinor / 100).toFixed(2), i.incrementalLossMinor === null ? "" : (i.incrementalLossMinor / 100).toFixed(2),
    i.confidence, i.enough ? "yes" : `no (needs ${MIN_AFFECTED} sessions)`, data.currency, i.groupId,
  ]);
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
