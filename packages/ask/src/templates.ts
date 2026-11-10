import { z } from "zod";
import {
  getBreakdown,
  getCheckoutFunnel,
  getErrorTrends,
  getOverviewMetrics,
  getPaymentsOverview,
  getRevenueLeaks,
  getGatewayHealth,
  getWebVitalsSummary,
  listErrorGroups,
  type BreakdownDimension,
} from "@trackme/analytics";
import type { MetricQueryRequest } from "@trackme/contracts";
import type { SourceId } from "./types.js";
import type { ResolvedRange } from "./scope.js";

/**
 * The vetted catalog the planner may call. The model never writes SQL and never supplies a tenant condition: it picks a
 * template id and typed parameters, and the template runs an existing analytics query (which already binds
 * `workspace_id` and `site_id`) and hands back rows the answer can cite.
 *
 * Every template returns a `TemplateResult`: a table label, the SQL text for the evidence card, the columns, and the rows.
 * The runner turns that into an `EvidenceItem`; nothing here touches limits, masking or the ClickHouse client directly.
 */

export interface TemplateContext {
  tenant: { workspaceId: string; siteId: string };
  /** Clamped by the runner: at most MAX_SCOPE_ROWS. */
  maxRows: number;
  range: ResolvedRange;
}

export interface TemplateResult {
  /** Human title for the evidence card. */
  title: string;
  table: string;
  /** The exact SQL the wrapped query runs, for the evidence card. Shown, never re-executed from here. */
  query: string;
  columns: string[];
  /** Scalar rows; the first `maxRows` are kept. */
  rows: Array<Array<string | number>>;
  /** The page that shows the same data. */
  path?: string;
  note?: string;
}

export interface Template<P = unknown> {
  id: string;
  source: SourceId;
  /** One line the planner reads to decide whether this template fits the question. */
  description: string;
  /** Validates the model's params. Typed loosely so a schema with defaults (input ≠ output) still assigns. */
  params: z.ZodTypeAny;
  run(ctx: TemplateContext, params: P): Promise<TemplateResult>;
}

function metricRequest(ctx: TemplateContext, filters?: MetricQueryRequest["filters"]): MetricQueryRequest {
  return {
    workspaceId: ctx.tenant.workspaceId,
    siteId: ctx.tenant.siteId,
    dateRange: { from: ctx.range.fromIso, to: ctx.range.toIso, granularity: "day" },
    ...(filters ? { filters } : {}),
    limit: Math.min(ctx.maxRows, 500),
    offset: 0,
  };
}

const Empty = z.object({}).default({});
/** What the model may ask for, and the analytics dimension each name reads. Every name must map: an unmapped one reaches ClickHouse as `undefined`. */
const DIMENSIONS = {
  page: "path",
  referrer: "referrer",
  channel: "channel",
  country: "country",
  city: "city",
  browser: "browser",
  device: "device",
  os: "os",
  source: "campaign_source",
  medium: "campaign_medium",
  campaign: "campaign_name",
} as const satisfies Record<string, BreakdownDimension>;
const BreakdownParams = z.object({ dimension: z.enum(Object.keys(DIMENSIONS) as [keyof typeof DIMENSIONS, ...Array<keyof typeof DIMENSIONS>]) });

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const minor = (n: number) => (n / 100).toFixed(2);

/* ───────────────────────────────── traffic ───────────────────────────────── */

const trafficOverview: Template<Record<string, never>> = {
  id: "traffic_overview",
  source: "traffic",
  description: "Visitors, sessions, pageviews, bounce rate and average duration for the range.",
  params: Empty,
  async run(ctx) {
    const m = await getOverviewMetrics(metricRequest(ctx));
    return {
      title: "Traffic overview",
      table: "dim_daily_agg · events_v2 (edges)",
      query: `SELECT sum(sessions) AS sessions, sum(pageviews) AS pageviews, sum(visitors) AS visitors,
       avg(bounce) AS bounce, avg(duration_s) AS avg_duration_s
FROM growth_analytics.dim_daily_agg
WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID} AND date BETWEEN {from:Date} AND {to:Date}`,
      columns: ["visitors", "sessions", "pageviews", "bounce rate", "avg duration (s)"],
      rows: [[m.visitors, m.sessions, m.pageviews, pct(m.bounceRatePercentage / 100), m.avgDurationSeconds]],
      path: "/overview",
    };
  },
};

const trafficBreakdown: Template<z.infer<typeof BreakdownParams>> = {
  id: "traffic_breakdown",
  source: "traffic",
  description: "Traffic split by one dimension: page, referrer, channel, country, city, browser, device, os, source, medium or campaign.",
  params: BreakdownParams,
  async run(ctx, { dimension }) {
    const r = await getBreakdown(metricRequest(ctx), DIMENSIONS[dimension]);
    const rows = r.items
      .slice(0, ctx.maxRows)
      .map((i) => [i.name, i.visitors, i.pageviews, pct(i.percentage / 100)]);
    return {
      title: `Traffic by ${dimension}`,
      table: `dim_daily_agg by ${dimension}`,
      query: `SELECT ${dimension}, sum(visitors) AS visitors, sum(pageviews) AS pageviews
FROM growth_analytics.dim_daily_agg
WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID} AND date BETWEEN {from:Date} AND {to:Date}
GROUP BY ${dimension} ORDER BY visitors DESC LIMIT {limit:UInt32}`,
      columns: [dimension, "visitors", "pageviews", "share"],
      rows,
      path: "/acquisition",
    };
  },
};

/* ───────────────────────────────── errors ───────────────────────────────── */

const errorsTop: Template<{ sort: "last_seen" | "events" | "users"; level?: string }> = {
  id: "errors_top",
  source: "errors",
  description: "Top error groups in the range, by events, users or most recent; optionally one level.",
  params: z.object({ sort: z.enum(["last_seen", "events", "users"]).default("events"), level: z.enum(["error", "warning", "info"]).optional() }),
  async run(ctx, { sort, level }) {
    const { groups } = await listErrorGroups({
      siteId: ctx.tenant.siteId,
      from: ctx.range.from,
      to: ctx.range.to,
      sort,
      limit: Math.min(ctx.maxRows, 100),
      ...(level ? { level } : {}),
    });
    return {
      title: "Top error groups",
      table: "error_daily_agg · error_groups",
      query: `SELECT g.group_id, anyLast(g.title) AS title, sum(d.events) AS events, sum(d.users) AS users,
       max(d.last_ts) AS last_seen
FROM growth_analytics.error_daily_agg d
JOIN growth_analytics.error_groups g ON g.group_id = d.group_id
WHERE d.workspace_id = {workspaceId:UUID} AND d.site_id = {siteId:UUID}
  AND d.date BETWEEN {from:Date} AND {to:Date}
GROUP BY g.group_id ORDER BY events DESC LIMIT {limit:UInt32}`,
      columns: ["group", "title", "type", "events", "users", "last seen"],
      rows: groups.map((g) => [g.groupId, g.title, g.type, g.events, g.users, g.lastSeen]),
      path: "/errors",
    };
  },
};

const errorTrend: Template<{ groupId: string }> = {
  id: "error_trend",
  source: "errors",
  description: "Daily occurrences for one error group, to see whether it is rising or falling.",
  params: z.object({ groupId: z.string().regex(/^\d{1,20}$/, "a numeric error group id") }),
  async run(ctx, { groupId }) {
    const points = await getErrorTrends(ctx.tenant.siteId, [groupId], ctx.range.from, ctx.range.to);
    return {
      title: "Error trend",
      table: "error_daily_agg",
      query: `SELECT day, sum(events) AS events FROM growth_analytics.error_daily_agg
WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID} AND group_id = {groupId:UInt64}
  AND date BETWEEN {from:Date} AND {to:Date}
GROUP BY day ORDER BY day`,
      columns: ["day", "events"],
      rows: points.slice(0, ctx.maxRows).map((p) => [p.date, p.events]),
      path: "/errors",
    };
  },
};

/* ───────────────────────────────── payments ───────────────────────────────── */

const paymentsOverview: Template<Record<string, never>> = {
  id: "payments_overview",
  source: "payments",
  description: "Revenue, attempts, failures and payers per currency; plus revenue by gateway and method.",
  params: Empty,
  async run(ctx) {
    const o = await getPaymentsOverview(ctx.tenant.siteId, { from: ctx.range.from, to: ctx.range.to });
    const rows: Array<Array<string | number>> = o.currencies.map((c) => [
      c.currency,
      minor(c.revenueMinor),
      c.paid,
      c.attempts,
      c.failed,
      c.payers,
    ]);
    for (const g of o.byGateway.slice(0, ctx.maxRows)) rows.push([`gateway:${g.key}`, minor(g.revenueMinor), g.paid, g.attempts, 0, 0]);
    return {
      title: "Payments by currency and gateway",
      table: "payment_events FINAL (per-payment outcome)",
      query: `SELECT currency, sum(amount * paid) / 100 AS revenue, sum(paid) AS paid, count() AS attempts,
       countIf(failed = 1 AND paid = 0) AS failed
FROM ( … one row per payment: captured wins over an earlier failure … )
WHERE site_id = {siteId:UUID} AND toDate(created_at) BETWEEN {from:Date} AND {to:Date}
GROUP BY currency`,
      columns: ["currency / gateway", "revenue", "paid", "attempts", "failed", "payers"],
      rows: rows.slice(0, ctx.maxRows),
      path: "/payments",
      note: "Money is integer minor units per currency; currencies are never summed together.",
    };
  },
};

const gatewayHealth: Template<Record<string, never>> = {
  id: "gateway_health",
  source: "payments",
  description: "Per gateway: success rate over 5 minutes, an hour and a day against its 7-day norm, and any incidents.",
  params: Empty,
  async run(ctx) {
    const health = await getGatewayHealth(ctx.tenant.siteId);
    const rows = health.map((g) => [
      g.gateway,
      g.last5m.successRate === null ? "—" : pct(g.last5m.successRate),
      g.last1h.successRate === null ? "—" : pct(g.last1h.successRate),
      g.last24h.successRate === null ? "—" : pct(g.last24h.successRate),
      g.incidents.length,
    ]);
    return {
      title: "Gateway health",
      table: "payment_events FINAL (5-minute buckets)",
      query: `SELECT gateway, toStartOfFiveMinute(done_at) AS bucket, count() AS outcomes, sum(was_paid) AS paid
FROM ( … one final outcome per payment … )
WHERE site_id = {siteId:UUID} AND done_at >= now() - INTERVAL 7 DAY
GROUP BY gateway, bucket ORDER BY bucket`,
      columns: ["gateway", "5m", "1h", "24h", "incidents"],
      rows: rows.slice(0, ctx.maxRows),
      path: "/payments/health",
      note: "An incident is a stretch of buckets whose failures are too many to be chance given the gateway's own norm.",
    };
  },
};

const checkoutFunnel: Template<{ checkoutPath?: string }> = {
  id: "checkout_funnel",
  source: "payments",
  description: "Sessions that viewed checkout, started a payment, reached the gateway and paid; split by browser and device.",
  params: z.object({ checkoutPath: z.string().max(200).default("/checkout") }),
  async run(ctx, { checkoutPath }) {
    const f = await getCheckoutFunnel(ctx.tenant.siteId, { from: ctx.range.from, to: ctx.range.to }, checkoutPath);
    const rows: Array<Array<string | number>> = [
      ["all", f.viewed, f.started, f.reached, f.paid],
      ...f.byBrowser.map((b) => [`browser:${b.key}`, b.viewed, b.started, b.reached, b.paid]),
    ];
    return {
      title: "Checkout funnel",
      table: "events_v2 ⨝ order_session ⨝ payment_events",
      query: `WITH viewers AS ( SELECT session_hash, any(browser) AS browser FROM growth_analytics.events_v2
  WHERE site_id = {siteId:UUID} AND type = 'pageview' AND path = {path:String}
    AND toDate(timestamp) BETWEEN {from:Date} AND {to:Date} GROUP BY session_hash )
SELECT browser, count() AS viewed, sum(started) AS started, sum(paid) AS paid
FROM ( … per session joined to order_session and payment_events … ) GROUP BY browser`,
      columns: ["segment", "viewed", "started", "reached", "paid"],
      rows: rows.slice(0, ctx.maxRows),
      path: "/payments/checkout",
    };
  },
};

const revenueLeaks: Template<Record<string, never>> = {
  id: "revenue_leaks",
  source: "payments",
  description: "Checkout sessions lost to errors: conversion with and without each error, and the money it plausibly cost.",
  params: Empty,
  async run(ctx) {
    const leaks = await getRevenueLeaks(ctx.tenant.siteId, { from: ctx.range.from, to: ctx.range.to });
    const rows = leaks.issues.map((i) => [
      i.title,
      i.affected,
      pct(i.affectedConversion),
      pct(i.controlConversion),
      i.incrementalLossMinor === null ? "too few" : `${(i.incrementalLossMinor / 100).toFixed(0)} ${leaks.currency}`,
      i.confidence,
    ]);
    return {
      title: "Revenue leaks from errors",
      table: "leak_sessions FINAL",
      query: `SELECT toString(g) AS group_id, count() AS affected, countIf(paid = 1) AS affected_paid
FROM growth_analytics.leak_sessions FINAL ARRAY JOIN error_groups AS g
WHERE site_id = {siteId:UUID} AND day BETWEEN {from:Date} AND {to:Date}
GROUP BY g ORDER BY affected DESC`,
      columns: ["error", "sessions", "paid with", "paid without", "beyond normal drop-off", "confidence"],
      rows: rows.slice(0, ctx.maxRows),
      path: "/payments/leaks",
      note: `Control conversion ${pct(leaks.conversion)} over ${leaks.sessions} checkout sessions. Figures are estimates, not a ledger.`,
    };
  },
};

/* ───────────────────────────────── releases ───────────────────────────────── */

const webVitals: Template<Record<string, never>> = {
  id: "web_vitals",
  source: "traffic",
  description: "Site speed: the 75th-percentile LCP, CLS, INP, FCP and TTFB with how many samples were good, needing work or poor. Use for any question about performance, speed or Core Web Vitals.",
  params: Empty,
  async run(ctx) {
    const items = await getWebVitalsSummary(metricRequest(ctx));
    return {
      title: "Web Vitals (75th percentile)",
      table: "web_vitals",
      query: `SELECT metric_name, quantile(0.75)(metric_value) AS p75, countIf(rating = 'good') AS good,
  countIf(rating = 'needs-improvement') AS needs_work, countIf(rating = 'poor') AS poor, count() AS samples
FROM growth_analytics.events_v2 WHERE site_id = {siteId:UUID} AND type = 'web_vital' AND timestamp BETWEEN {from} AND {to}
GROUP BY metric_name`,
      columns: ["metric", "p75", "good", "needs work", "poor", "samples"],
      rows: items.map((i) => [i.metric, i.p75, i.goodCount, i.needsImprovementCount, i.poorCount, i.totalSamples]),
      path: "/vitals",
    };
  },
};

const AllTemplates = [
  trafficOverview,
  webVitals,
  trafficBreakdown,
  errorsTop,
  errorTrend,
  paymentsOverview,
  gatewayHealth,
  checkoutFunnel,
  revenueLeaks,
] as Array<Template<unknown>>;

const BY_ID = new Map(AllTemplates.map((t) => [t.id, t]));

export function allTemplates(): Template<unknown>[] {
  return AllTemplates;
}

export function getTemplate(id: string): Template<unknown> | undefined {
  return BY_ID.get(id);
}

/** The catalog as the planner sees it: ids, sources, descriptions and the JSON schema of each template's params. */
export function catalogForPrompt(): Array<{ id: string; source: SourceId; description: string; params: unknown }> {
  return AllTemplates.map((t) => ({ id: t.id, source: t.source, description: t.description, params: zodShape(t.params) }));
}

function zodShape(schema: z.ZodType<unknown>): unknown {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(shape)) {
      const inner = v instanceof z.ZodDefault ? v._def.innerType : v;
      out[k] = inner._def.typeName.replace("Zod", "").toLowerCase();
    }
    return out;
  }
  return {};
}
