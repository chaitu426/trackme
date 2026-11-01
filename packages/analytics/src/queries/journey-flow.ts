import { MetricQueryRequest } from "@trackme/contracts";
import { readClient, variantAware, type ReadVariant } from "../read-mode.js";
import { buildDimensionFilterSql } from "./filters.js";
import { AnalyticsQueryError } from "../errors.js";

/** How many steps of a session the flow follows. */
export const FLOW_DEPTH = 6;
const MAX_TRACE_STEPS = 8;

function toCH(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

/**
 * One row per (step, page, next page): how many sessions viewed `node` as their
 * `step`-th distinct page and went on to `next` ("" when the session ended there).
 */
export interface FlowRow {
  step: number;
  node: string;
  next: string;
  sessions: number;
}

/**
 * Per-session sequences of distinct consecutive pages (a refresh or a repeated
 * view is not a new step). Shared by the flow and the trace.
 */
function sequencesSql(filterClause: string): string {
  return `
    sequences AS (
      SELECT
        any(visitor_pseudonym) AS visitor,
        arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((timestamp, path)))) AS raw
      FROM events_raw
      WHERE workspace_id = {workspaceId:UUID}
        AND site_id = {siteId:UUID}
        AND timestamp >= {from:DateTime64}
        AND timestamp <= {to:DateTime64}
        AND bot_status = 'human'
        AND type = 'pageview'
        AND path != ''
        ${filterClause}
      GROUP BY session_id
    ),
    deduped AS (
      SELECT visitor, arrayFilter((p, i) -> i = 1 OR p != raw[i - 1], raw, arrayEnumerate(raw)) AS seq
      FROM sequences
    )`;
}

function baseParams(request: MetricQueryRequest, extra: Record<string, string>) {
  return {
    workspaceId: request.workspaceId,
    siteId: request.siteId,
    from: toCH(request.dateRange.from),
    to: toCH(request.dateRange.to),
    ...extra,
  };
}

async function getJourneyFlowRowsImpl(request: MetricQueryRequest, variant: ReadVariant): Promise<FlowRow[]> {
  try {
    const client = readClient(variant);
    const filter = buildDimensionFilterSql(request.filters);
    const resultSet = await client.query({
      query: `
        WITH ${sequencesSql(filter.clause)}
        SELECT
          idx AS step,
          seq[idx] AS node,
          if(idx < length(seq), seq[idx + 1], '') AS next,
          count() AS sessions
        FROM deduped
        ARRAY JOIN arrayEnumerate(arraySlice(seq, 1, {depth:UInt8})) AS idx
        GROUP BY step, node, next
        ORDER BY sessions DESC
        LIMIT 6000
      `,
      query_params: { ...baseParams(request, filter.params), depth: FLOW_DEPTH },
      format: "JSONEachRow",
    });
    const rows = await resultSet.json<{ step: string | number; node: string; next: string; sessions: string | number }>();
    return rows.map((r) => ({ step: Number(r.step), node: r.node, next: r.next, sessions: Number(r.sessions) }));
  } catch (err) {
    if (err instanceof AnalyticsQueryError) throw err;
    throw new AnalyticsQueryError("ClickHouse journey flow query failed", { cause: err });
  }
}

export const getJourneyFlowRows = variantAware("getJourneyFlowRows", getJourneyFlowRowsImpl);

export interface RouteSummary {
  /** Distinct consecutive pages, first FLOW_DEPTH of them. */
  route: string[];
  sessions: number;
  visitors: number;
}

export interface RouteReport {
  routes: RouteSummary[];
  totalSessions: number;
  /** Sessions that viewed one page only, which have no route to show. */
  singlePageSessions: number;
}

/** The most common multi-page routes. A refresh or repeated view does not count as a step. */
async function getJourneyRoutesImpl(
  request: MetricQueryRequest,
  limit: number,
  variant: ReadVariant
): Promise<RouteReport> {
  try {
    const client = readClient(variant);
    const filter = buildDimensionFilterSql(request.filters);
    const params = { ...baseParams(request, filter.params), depth: FLOW_DEPTH, limit };
    const [routeSet, totalSet] = await Promise.all([
      client.query({
        query: `
          WITH ${sequencesSql(filter.clause)}
          SELECT arraySlice(seq, 1, {depth:UInt8}) AS route, count() AS sessions, uniqExact(visitor) AS visitors
          FROM deduped
          WHERE length(seq) >= 2
          GROUP BY route
          ORDER BY sessions DESC, visitors DESC
          LIMIT {limit:UInt32}
        `,
        query_params: params,
        format: "JSONEachRow",
      }),
      client.query({
        query: `
          WITH ${sequencesSql(filter.clause)}
          SELECT count() AS total, countIf(length(seq) = 1) AS single FROM deduped
        `,
        query_params: params,
        format: "JSONEachRow",
      }),
    ]);
    const routes = await routeSet.json<{ route: string[]; sessions: string | number; visitors: string | number }>();
    const [totals] = await totalSet.json<{ total: string | number; single: string | number }>();
    return {
      routes: routes.map((r) => ({ route: r.route, sessions: Number(r.sessions), visitors: Number(r.visitors) })),
      totalSessions: Number(totals?.total ?? 0),
      singlePageSessions: Number(totals?.single ?? 0),
    };
  } catch (err) {
    if (err instanceof AnalyticsQueryError) throw err;
    throw new AnalyticsQueryError("ClickHouse journey routes query failed", { cause: err });
  }
}

export const getJourneyRoutes = variantAware("getJourneyRoutes", getJourneyRoutesImpl);

/** For each prefix length k of a journey: where the sessions that followed it that far went next. */
export interface TraceRow {
  k: number;
  next: string;
  sessions: number;
}

async function getJourneyTraceRowsImpl(
  request: MetricQueryRequest,
  journey: string[],
  variant: ReadVariant
): Promise<TraceRow[]> {
  const steps = journey.slice(0, MAX_TRACE_STEPS);
  if (steps.length === 0) return [];
  try {
    const client = readClient(variant);
    const filter = buildDimensionFilterSql(request.filters);
    const resultSet = await client.query({
      query: `
        WITH ${sequencesSql(filter.clause)}
        SELECT
          k,
          if(length(seq) > k, seq[k + 1], '') AS next,
          count() AS sessions
        FROM deduped
        ARRAY JOIN range(1, {n:UInt8} + 1) AS k
        WHERE arraySlice(seq, 1, k) = arraySlice({journey:Array(String)}, 1, k)
        GROUP BY k, next
        ORDER BY k ASC, sessions DESC
        LIMIT 2000
      `,
      query_params: { ...baseParams(request, filter.params), n: steps.length, journey: steps },
      format: "JSONEachRow",
    });
    const rows = await resultSet.json<{ k: string | number; next: string; sessions: string | number }>();
    return rows.map((r) => ({ k: Number(r.k), next: r.next, sessions: Number(r.sessions) }));
  } catch (err) {
    if (err instanceof AnalyticsQueryError) throw err;
    throw new AnalyticsQueryError("ClickHouse journey trace query failed", { cause: err });
  }
}

export const getJourneyTraceRows = variantAware("getJourneyTraceRows", getJourneyTraceRowsImpl);

/** What a session can be split by in the journey segment table. */
export const JOURNEY_SEGMENTS = {
  device: "device",
  country: "country",
  browser: "browser",
  os: "os",
} as const;
export type JourneySegment = keyof typeof JOURNEY_SEGMENTS;

export interface SegmentReachRow {
  segment: string;
  page: string;
  sessions: number;
}

export interface SegmentTotalRow {
  segment: string;
  sessions: number;
}

/** Per segment value: sessions that viewed each page, and total sessions. */
async function getJourneySegmentRowsImpl(
  request: MetricQueryRequest,
  segment: JourneySegment,
  variant: ReadVariant
): Promise<{ reach: SegmentReachRow[]; totals: SegmentTotalRow[] }> {
  const column = JOURNEY_SEGMENTS[segment];
  try {
    const client = readClient(variant);
    const filter = buildDimensionFilterSql(request.filters);
    const params = baseParams(request, filter.params);
    const inner = `
      SELECT
        session_id,
        if(trim(toString(any(${column}))) = '', 'Unknown', trim(toString(any(${column})))) AS seg,
        arrayDistinct(groupArray(path)) AS pages
      FROM events_raw
      WHERE workspace_id = {workspaceId:UUID}
        AND site_id = {siteId:UUID}
        AND timestamp >= {from:DateTime64}
        AND timestamp <= {to:DateTime64}
        AND bot_status = 'human'
        AND type = 'pageview'
        AND path != ''
        ${filter.clause}
      GROUP BY session_id
    `;
    const [reachSet, totalSet] = await Promise.all([
      client.query({
        query: `
          SELECT seg AS segment, page, count() AS sessions
          FROM (${inner})
          ARRAY JOIN pages AS page
          GROUP BY segment, page
          ORDER BY sessions DESC
          LIMIT 3000
        `,
        query_params: params,
        format: "JSONEachRow",
      }),
      client.query({
        query: `SELECT seg AS segment, count() AS sessions FROM (${inner}) GROUP BY segment ORDER BY sessions DESC LIMIT 50`,
        query_params: params,
        format: "JSONEachRow",
      }),
    ]);
    const reach = await reachSet.json<{ segment: string; page: string; sessions: string | number }>();
    const totals = await totalSet.json<{ segment: string; sessions: string | number }>();
    return {
      reach: reach.map((r) => ({ segment: r.segment, page: r.page, sessions: Number(r.sessions) })),
      totals: totals.map((r) => ({ segment: r.segment, sessions: Number(r.sessions) })),
    };
  } catch (err) {
    if (err instanceof AnalyticsQueryError) throw err;
    throw new AnalyticsQueryError("ClickHouse journey segment query failed", { cause: err });
  }
}

export const getJourneySegmentRows = variantAware("getJourneySegmentRows", getJourneySegmentRowsImpl);

/* ───────────────────────────── shaping (pure) ───────────────────────────── */

export const OTHER_NODE = "__other__";
export const EXIT_NODE = "__exit__";

export interface FlowNode {
  id: string;
  step: number;
  /** A page path, or OTHER_NODE / EXIT_NODE. */
  page: string;
  sessions: number;
}

export interface FlowLink {
  source: string;
  target: string;
  sessions: number;
}

export interface FlowGraph {
  totalSessions: number;
  steps: number;
  nodes: FlowNode[];
  links: FlowLink[];
}

export const nodeId = (step: number, page: string) => `${step}:${page}`;

/**
 * Turns raw (step, page, next) rows into a drawable graph: at most `perStep` named
 * pages per column (the rest fold into "other pages"), plus an "exit" node per column
 * for sessions that ended there. Every session in a column is accounted for, so
 * column totals are comparable and link widths add up.
 */
export function buildFlowGraph(rows: FlowRow[], perStep = 6, maxSteps = FLOW_DEPTH): FlowGraph {
  const byStep = new Map<number, Map<string, number>>();
  for (const r of rows) {
    if (r.step < 1 || r.step > maxSteps) continue;
    const col = byStep.get(r.step) ?? new Map<string, number>();
    col.set(r.node, (col.get(r.node) ?? 0) + r.sessions);
    byStep.set(r.step, col);
  }

  // Which pages keep their own node in each column.
  const kept = new Map<number, Set<string>>();
  for (const [step, col] of byStep) {
    kept.set(
      step,
      new Set([...col.entries()].sort((a, b) => b[1] - a[1]).slice(0, perStep).map(([page]) => page))
    );
  }
  const pageNode = (step: number, page: string) => (kept.get(step)?.has(page) ? page : OTHER_NODE);

  const nodeSessions = new Map<string, FlowNode>();
  const linkSessions = new Map<string, FlowLink>();
  const addNode = (step: number, page: string, sessions: number) => {
    const id = nodeId(step, page);
    const existing = nodeSessions.get(id);
    if (existing) existing.sessions += sessions;
    else nodeSessions.set(id, { id, step, page, sessions });
  };
  const addLink = (source: string, target: string, sessions: number) => {
    const key = `${source}>${target}`;
    const existing = linkSessions.get(key);
    if (existing) existing.sessions += sessions;
    else linkSessions.set(key, { source, target, sessions });
  };

  const lastStep = Math.max(0, ...byStep.keys());
  for (const r of rows) {
    if (r.step < 1 || r.step > maxSteps) continue;
    const from = pageNode(r.step, r.node);
    addNode(r.step, from, r.sessions);
    if (r.next === "") {
      // The session ended on this page. The last column has no onward flow to draw.
      if (r.step < lastStep) {
        addNode(r.step + 1, EXIT_NODE, r.sessions);
        addLink(nodeId(r.step, from), nodeId(r.step + 1, EXIT_NODE), r.sessions);
      }
    } else if (r.step < maxSteps && byStep.has(r.step + 1)) {
      const to = pageNode(r.step + 1, r.next);
      addLink(nodeId(r.step, from), nodeId(r.step + 1, to), r.sessions);
    }
  }

  const totalSessions = [...(byStep.get(1)?.values() ?? [])].reduce((a, b) => a + b, 0);
  return {
    totalSessions,
    steps: lastStep,
    nodes: [...nodeSessions.values()],
    links: [...linkSessions.values()],
  };
}

export interface TraceStep {
  index: number;
  page: string;
  /** Sessions that followed the journey exactly this far. */
  sessions: number;
  /** Where the sessions that stopped following the journey went instead. */
  deviations: { page: string; sessions: number }[];
  /** Sessions that ended on this page. */
  exits: number;
}

/** Folds trace rows into per-step reach, exits and top detours. */
export function buildTrace(journey: string[], rows: TraceRow[], detours = 4): TraceStep[] {
  return journey.slice(0, MAX_TRACE_STEPS).map((page, i) => {
    const k = i + 1;
    const here = rows.filter((r) => r.k === k);
    const sessions = here.reduce((sum, r) => sum + r.sessions, 0);
    const onward = journey[k];
    return {
      index: k,
      page,
      sessions,
      exits: here.find((r) => r.next === "")?.sessions ?? 0,
      deviations: here
        .filter((r) => r.next !== "" && r.next !== onward)
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, detours)
        .map((r) => ({ page: r.next, sessions: r.sessions })),
    };
  });
}

export interface SegmentTable {
  pages: string[];
  rows: { segment: string; sessions: number; cells: { page: string; sessions: number; pct: number }[] }[];
}

/** Top pages as columns, top segments as rows; each cell is the share of that segment's sessions that viewed the page. */
export function buildSegmentTable(
  reach: SegmentReachRow[],
  totals: SegmentTotalRow[],
  maxPages = 6,
  maxRows = 6
): SegmentTable {
  const pageTotals = new Map<string, number>();
  for (const r of reach) pageTotals.set(r.page, (pageTotals.get(r.page) ?? 0) + r.sessions);
  const pages = [...pageTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxPages).map(([p]) => p);
  const reachMap = new Map(reach.map((r) => [`${r.segment}\u0000${r.page}`, r.sessions]));

  const rows = [...totals]
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, maxRows)
    .map((t) => ({
      segment: t.segment,
      sessions: t.sessions,
      cells: pages.map((page) => {
        const sessions = reachMap.get(`${t.segment}\u0000${page}`) ?? 0;
        return { page, sessions, pct: t.sessions > 0 ? Math.round((sessions / t.sessions) * 1000) / 10 : 0 };
      }),
    }));
  return { pages, rows };
}
