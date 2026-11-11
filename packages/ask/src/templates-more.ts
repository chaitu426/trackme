import { z } from "zod";
import {
  getCustomEventsSummary,
  getFailureOverview,
  getNewIssues,
  getOverviewMetrics,
  getPageEngagement,
  getRecovery,
  getRefundsAndDisputes,
  getReleasesSeen,
  getRetention,
  getTimeSeries,
  getWebVitalsByPage,
  profileStats,
} from "@trackme/analytics";
import type { MetricQueryRequest } from "@trackme/contracts";
import type { Template, TemplateContext } from "./templates.js";

/**
 * The second half of the catalog: comparisons, trends, page-level detail, payments failure analysis, releases, retention and
 * people. Same rules as `templates.ts`: the model picks an id and typed params, tenant conditions are bound inside the
 * wrapped analytics function, and nothing here touches ClickHouse directly. Aggregates only: no template returns a person's
 * name, email or id, so masking cannot be bypassed by choosing the wrong template.
 */

const DAY_MS = 86_400_000;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const minor = (n: number) => (n / 100).toFixed(2);
const Empty = z.object({}).default({});

function request(ctx: TemplateContext, range: { fromIso: string; toIso: string }, granularity: "hour" | "day" | "month" = "day"): MetricQueryRequest {
  return {
    workspaceId: ctx.tenant.workspaceId,
    siteId: ctx.tenant.siteId,
    dateRange: { from: range.fromIso, to: range.toIso, granularity },
    limit: Math.min(ctx.maxRows, 500),
    offset: 0,
  };
}

/** The same length of time immediately before the range, so "vs the period before" compares like with like. */
function previousRange(ctx: TemplateContext): { fromIso: string; toIso: string; from: string; to: string } {
  const from = Date.parse(ctx.range.fromIso);
  const span = Date.parse(ctx.range.toIso) - from;
  const toMs = from - 1;
  const fromMs = from - span - 1;
  const toIso = new Date(toMs).toISOString();
  const fromIso = new Date(fromMs).toISOString();
  return { fromIso, toIso, from: fromIso.slice(0, 10), to: toIso.slice(0, 10) };
}

const change = (cur: number, prev: number): string => (prev === 0 ? (cur === 0 ? "0" : "new") : `${(((cur - prev) / prev) * 100).toFixed(1)}%`);

/* ───────────────────────────────── traffic ───────────────────────────────── */

const comparePeriods: Template<Record<string, never>> = {
  id: "compare_periods",
  source: "traffic",
  description:
    "This period against the equal-length period just before it: visitors, sessions, pageviews, bounce rate, duration, each with the change in percent. Use for any 'vs last week/month', 'up or down', 'did it improve' question.",
  params: Empty,
  async run(ctx) {
    const prev = previousRange(ctx);
    const [cur, old] = await Promise.all([getOverviewMetrics(request(ctx, ctx.range)), getOverviewMetrics(request(ctx, prev))]);
    const row = (label: string, c: number, p: number, fmt: (n: number) => string = String): Array<string | number> => [label, fmt(c), fmt(p), change(c, p)];
    return {
      title: "This period vs the one before",
      table: "dim_daily_agg (two windows)",
      query: `SELECT sum(visitors), sum(sessions), sum(pageviews), avg(bounce), avg(duration_s)
FROM growth_analytics.dim_daily_agg
WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID} AND date BETWEEN {from:Date} AND {to:Date}
-- run twice: the range, and the same number of days immediately before it (${prev.from} to ${prev.to})`,
      columns: ["metric", "this period", "previous period", "change"],
      rows: [
        row("visitors", cur.visitors, old.visitors),
        row("sessions", cur.sessions, old.sessions),
        row("pageviews", cur.pageviews, old.pageviews),
        row("bounce rate", cur.bounceRatePercentage, old.bounceRatePercentage, (n) => `${n.toFixed(1)}%`),
        row("avg duration (s)", cur.avgDurationSeconds, old.avgDurationSeconds),
      ],
      path: "/overview",
      note: `Previous period: ${prev.from} to ${prev.to}.`,
    };
  },
};

const TimeSeriesParams = z.object({ granularity: z.enum(["hour", "day", "month"]).default("day") });
const trafficTimeseries: Template<z.infer<typeof TimeSeriesParams>> = {
  id: "traffic_timeseries",
  source: "traffic",
  description: "Visitors, sessions, pageviews, bounce rate per hour, day or month across the range. Use for trends, spikes, dips and 'when did it change'.",
  params: TimeSeriesParams,
  async run(ctx, { granularity }) {
    // Hourly series over a long range exceed the point limit; fall back to days rather than fail.
    const days = (Date.parse(ctx.range.toIso) - Date.parse(ctx.range.fromIso)) / DAY_MS;
    const g = granularity === "hour" && days > 14 ? "day" : granularity;
    const points = await getTimeSeries(request(ctx, ctx.range, g));
    return {
      title: `Traffic per ${g}`,
      table: "dim_daily_agg / events_v2 by bucket",
      query: `SELECT bucket, uniq(visitor) AS visitors, uniq(session) AS sessions, countIf(type='pageview') AS pageviews
FROM growth_analytics.events_v2
WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID} AND timestamp BETWEEN {from} AND {to}
GROUP BY toStartOf${g === "hour" ? "Hour" : g === "month" ? "Month" : "Day"}(timestamp) AS bucket ORDER BY bucket`,
      columns: ["time", "visitors", "sessions", "pageviews", "bounce rate"],
      rows: points.slice(-ctx.maxRows).map((p) => [p.timestamp, p.visitors, p.sessions, p.pageviews, `${p.bounceRate.toFixed(1)}%`]),
      path: "/overview",
      ...(g !== granularity ? { note: `Hourly is only available for ranges up to 14 days; shown per ${g}.` } : {}),
    };
  },
};

const PagesParams = z.object({ limit: z.number().int().min(1).max(50).default(15) });
const pageEngagement: Template<z.infer<typeof PagesParams>> = {
  id: "page_engagement",
  source: "traffic",
  description: "Per page: views, visitors, time on page, entrances, bounce rate and exit rate. Use for 'which pages lose people', 'best/worst pages', landing pages.",
  params: PagesParams,
  async run(ctx, { limit }) {
    const rows = await getPageEngagement(request(ctx, ctx.range), Math.min(limit, ctx.maxRows));
    return {
      title: "Page engagement",
      table: "events_v2 (pageview, engagement)",
      query: `SELECT path, count() AS pageviews, uniq(visitor) AS visitors, avg(active_ms) AS avg_active, -- plus entrances, bounces and exits per session
FROM growth_analytics.events_v2
WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID} AND type = 'pageview' AND bot_status = 'human'
  AND timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
GROUP BY path ORDER BY pageviews DESC LIMIT {limit:UInt32}`,
      columns: ["page", "views", "visitors", "avg active (s)", "entrances", "bounce %", "exit %"],
      rows: rows.map((r) => [r.path, r.pageviews, r.visitors, r.avgActiveSeconds ?? "—", r.entrances, r.bounceRate ?? "—", r.exitRate ?? "—"]),
      path: "/pages",
    };
  },
};

const vitalsByPage: Template<z.infer<typeof PagesParams>> = {
  id: "web_vitals_by_page",
  source: "traffic",
  description: "75th-percentile Core Web Vitals per page: which pages are slow, and on which metric. Use after web_vitals shows a problem, or for 'which page is slowest'.",
  params: PagesParams,
  async run(ctx, { limit }) {
    const rows = await getWebVitalsByPage(request(ctx, ctx.range), Math.min(limit * 5, 250));
    return {
      title: "Web Vitals by page (75th percentile)",
      table: "events_v2 (web_vital) by path",
      query: `SELECT path, metric_name, quantile(0.75)(metric_value) AS p75, count() AS samples
FROM growth_analytics.events_v2
WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID} AND type = 'web_vital' AND timestamp BETWEEN {from} AND {to}
GROUP BY path, metric_name`,
      columns: ["page", "metric", "p75", "samples", "good", "needs work", "poor"],
      rows: rows.slice(0, ctx.maxRows).map((r) => [r.path, r.metric, r.p75, r.samples, r.goodCount, r.needsImprovementCount, r.poorCount]),
      path: "/vitals",
    };
  },
};

const customEvents: Template<Record<string, never>> = {
  id: "custom_events",
  source: "traffic",
  description: "Custom events the site tracks (signups, clicks, add-to-cart and so on): how often each fired and how many visitors fired it.",
  params: Empty,
  async run(ctx) {
    const rows = await getCustomEventsSummary(request(ctx, ctx.range));
    return {
      title: "Custom events",
      table: "events_v2 (custom)",
      query: `SELECT event_name, count() AS count, uniq(session) AS sessions, uniq(visitor) AS visitors, max(timestamp) AS last_seen
FROM growth_analytics.events_v2
WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID} AND type = 'custom' AND timestamp BETWEEN {from} AND {to}
GROUP BY event_name ORDER BY count DESC`,
      columns: ["event", "count", "sessions", "visitors", "last seen"],
      rows: rows.slice(0, ctx.maxRows).map((r) => [r.eventName, r.count, r.uniqueSessions, r.uniqueVisitors, r.lastSeen]),
      path: "/events",
    };
  },
};

/* ───────────────────────────────── payments ───────────────────────────────── */

const paymentFailures: Template<Record<string, never>> = {
  id: "payment_failures",
  source: "payments",
  description: "Why payments fail: failure categories with counts and value, the top raw gateway codes, and how many followed a browser error. Use for any 'why are payments failing' question.",
  params: Empty,
  async run(ctx) {
    const o = await getFailureOverview(ctx.tenant.siteId, { from: ctx.range.from, to: ctx.range.to });
    return {
      title: "Payment failures by cause",
      table: "payment_failure_class FINAL",
      query: `SELECT category, currency, count() AS failures, sum(amount_minor) AS value, countIf(session_error = 1) AS after_browser_error
FROM growth_analytics.payment_failure_class FINAL
WHERE site_id = {siteId:UUID} AND toDate(failed_at) BETWEEN {from:Date} AND {to:Date}
GROUP BY category, currency ORDER BY value DESC`,
      columns: ["cause", "currency", "failures", "value", "after a browser error", "top codes"],
      rows: o.categories.slice(0, ctx.maxRows).map((c) => [
        c.category,
        c.currency,
        c.count,
        minor(c.valueMinor),
        c.withSessionError,
        o.codes.filter((k) => k.category === c.category).map((k) => `${k.code} (${k.count})`).join(", "),
      ]),
      path: "/payments/failures",
      note: `${o.classified} failures classified, ${o.unknown} unknown. Money is integer minor units per currency; currencies are never summed together.`,
    };
  },
};

const paymentRecovery: Template<Record<string, never>> = {
  id: "payment_recovery",
  source: "payments",
  description: "Of the customers whose payment failed, how many paid within 24 and 72 hours, and the value recovered, by failure cause.",
  params: Empty,
  async run(ctx) {
    const r = await getRecovery(ctx.tenant.siteId, { from: ctx.range.from, to: ctx.range.to });
    return {
      title: "Failed payments recovered",
      table: "payment_failure_class ⨝ payment_events",
      query: `-- for each failure, the earliest later capture by the same order or customer within 72 hours
SELECT category, currency, count() AS failed, countIf(delay <= 86400) AS recovered_24h, countIf(delay <= 259200) AS recovered_72h
FROM ( ... failures joined to later captures ... ) GROUP BY category, currency`,
      columns: ["cause", "currency", "failed", "failed value", "recovered in 24h", "recovered in 72h", "value recovered (72h)"],
      rows: r.rows.slice(0, ctx.maxRows).map((x) => [x.category, x.currency, x.failed, minor(x.valueMinor), x.recovered24, x.recovered72, minor(x.recoveredValue72Minor)]),
      path: "/payments/recovery",
    };
  },
};

const refundsDisputes: Template<Record<string, never>> = {
  id: "refunds_disputes",
  source: "payments",
  description: "Refunds and chargebacks: counts and value against captured value, and the most common reasons.",
  params: Empty,
  async run(ctx) {
    const r = await getRefundsAndDisputes(ctx.tenant.siteId, { from: ctx.range.from, to: ctx.range.to });
    const rows: Array<Array<string | number>> = r.summary.map((s) => [
      s.currency,
      s.refundedCount,
      minor(s.refundedMinor),
      s.disputedCount,
      minor(s.disputedMinor),
      s.capturedCount,
      minor(s.capturedMinor),
      s.capturedMinor > 0 ? pct(s.refundedMinor / s.capturedMinor) : "—",
    ]);
    for (const reason of r.reasons.slice(0, 5)) rows.push([`${reason.kind}: ${reason.reason}`, reason.count, "", "", "", "", "", ""]);
    return {
      title: "Refunds and disputes",
      table: "payment_events FINAL (refunded / disputed)",
      query: `SELECT currency, countIf(status='refunded'), sumIf(amount, status='refunded'), countIf(status='disputed'), sumIf(amount, status='disputed'),
       countIf(status='captured'), sumIf(amount, status='captured')
FROM growth_analytics.payment_events FINAL
WHERE site_id = {siteId:UUID} AND toDate(created_at) BETWEEN {from:Date} AND {to:Date} GROUP BY currency`,
      columns: ["currency / reason", "refunds", "refunded", "disputes", "disputed", "captures", "captured", "refund rate"],
      rows: rows.slice(0, ctx.maxRows),
      path: "/payments/refunds",
    };
  },
};

/* ───────────────────────────────── releases ───────────────────────────────── */

const releasesSeen: Template<Record<string, never>> = {
  id: "releases_seen",
  source: "releases",
  description: "Releases that real sessions ran on in the last 90 days, newest first, with when each first appeared. Use to find a release name before asking what it broke.",
  params: Empty,
  async run(ctx) {
    const rows = await getReleasesSeen(ctx.tenant.siteId);
    return {
      title: "Recent releases",
      table: "session_summary_agg",
      query: `SELECT rel AS release, count() AS sessions, min(first) AS first_seen FROM session_summary_agg
WHERE site_id = {siteId:UUID} AND date >= today() - 90 AND rel != '' GROUP BY rel ORDER BY first_seen DESC LIMIT 100`,
      columns: ["release", "sessions", "first seen"],
      rows: rows.slice(0, ctx.maxRows).map((r) => [r.release, r.sessions, r.firstSeen]),
      path: "/releases",
    };
  },
};

const ReleaseIssuesParams = z.object({ release: z.string().min(1).max(200), since: z.string().max(40).optional() });
const releaseNewIssues: Template<z.infer<typeof ReleaseIssuesParams>> = {
  id: "release_new_issues",
  source: "releases",
  description: "Error groups that first appeared in one named release (from releases_seen), most frequent first. Use for 'did release X break anything'.",
  params: ReleaseIssuesParams,
  async run(ctx, { release, since }) {
    const seen = await getReleasesSeen(ctx.tenant.siteId);
    const match = seen.find((r) => r.release === release);
    const from = since ?? match?.firstSeen ?? ctx.range.fromIso;
    const issues = await getNewIssues(ctx.tenant.siteId, release, from);
    return {
      title: `New issues in ${release}`,
      table: "error_groups",
      query: `SELECT toString(group_id), anyLast(title), sum(events) FROM growth_analytics.error_groups
WHERE site_id = {siteId:UUID} GROUP BY group_id
HAVING argMinMerge(first_release) = {release:String} AND min(first_seen) >= {since:DateTime64} ORDER BY sum(events) DESC LIMIT 20`,
      columns: ["group", "title", "events"],
      rows: issues.slice(0, ctx.maxRows).map((i) => [i.groupId, i.title, i.events]),
      path: "/releases",
      note: match ? `Release first seen ${match.firstSeen}.` : "That release name was not among the releases seen in the last 90 days.",
    };
  },
};

/* ───────────────────────────────── people (aggregates only) ───────────────────────────────── */

const RetentionParams = z.object({ granularity: z.enum(["day", "week", "month"]).default("week"), periods: z.number().int().min(1).max(12).default(6) });
const retention: Template<z.infer<typeof RetentionParams>> = {
  id: "retention",
  source: "people",
  description: "Cohort retention of identified users: of the people who first showed up in each period, how many came back in each later period. Anonymous visitors are not included.",
  params: RetentionParams,
  async run(ctx, { granularity, periods }) {
    const cohorts = await getRetention({
      siteId: ctx.tenant.siteId,
      granularity,
      from: ctx.range.from,
      to: ctx.range.to,
      cohort: { kind: "first_visit" },
      periods,
    });
    const rows = cohorts.slice(0, ctx.maxRows).map((c) => [
      c.cohort,
      c.size,
      ...Array.from({ length: periods }, (_, i) => {
        const v = c.retained[i];
        return v === null || v === undefined ? "—" : c.size > 0 ? pct(v / c.size) : "—";
      }),
    ]);
    return {
      title: `Retention by ${granularity} cohort`,
      table: "user_first_day ⨝ user_active_day",
      query: `SELECT cohort_day, count() AS size, -- then per period N: uniqIf(user_id, active in period N)
FROM user_first_day f JOIN user_active_day a USING (site_id, user_id)
WHERE site_id = {siteId:UUID} AND cohort_day BETWEEN {from:Date} AND {to:Date} GROUP BY cohort_day`,
      columns: ["cohort", "people", ...Array.from({ length: periods }, (_, i) => `${granularity} ${i + 1}`)],
      rows,
      path: "/retention",
      note: "Identified users only; anonymous visitors rotate their id daily and cannot be followed.",
    };
  },
};

const peopleOverview: Template<Record<string, never>> = {
  id: "people_overview",
  source: "people",
  description: "How many identified people the site has, how many were active in the last 7 days, and their average event count. Counts only; no names or identifiers.",
  params: Empty,
  async run(ctx) {
    const s = await profileStats(ctx.tenant.workspaceId, ctx.tenant.siteId);
    return {
      title: "Identified people",
      table: "site_profiles_agg",
      query: `SELECT count() AS total, countIf(last_seen >= now() - INTERVAL 7 DAY) AS active_7d, avg(events) AS avg_events
FROM ( SELECT distinct_id, max(last_seen) AS last_seen, sum(events) AS events FROM site_profiles_agg
       WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID} GROUP BY distinct_id )`,
      columns: ["identified people", "active in last 7 days", "avg events per person"],
      rows: [[s.total, s.active7d, s.avgEvents]],
      path: "/people",
      note: "Not limited to the selected range: a profile is the person's whole history.",
    };
  },
};

export const moreTemplates = [
  comparePeriods,
  trafficTimeseries,
  pageEngagement,
  vitalsByPage,
  customEvents,
  paymentFailures,
  paymentRecovery,
  refundsDisputes,
  releasesSeen,
  releaseNewIssues,
  retention,
  peopleOverview,
] as Array<Template<unknown>>;
