import {
  getBreakdown,
  getCampaignBreakdown,
  getOverviewMetrics,
  getTimeSeries,
  getTopJourneys,
  getWebVitalsSummary,
  getPageEngagement,
  getWebVitalsByPage,
  getJourneyFlowRows,
  getJourneyRoutes,
  getJourneySegmentRows,
  getJourneyTraceRows,
  buildFlowGraph,
  buildSegmentTable,
  buildTrace,
  type BreakdownDimension,
  type JourneySegment,
} from "@trackme/analytics";
import type { MetricQueryRequest } from "@trackme/contracts";
import { cached, cacheKey, normalizeRequest, ttlSecondsFor } from "./query-cache";

/**
 * Cached versions of the dashboard reads, for server-rendered pages. The API routes cache
 * the same way, so the page and the routes share entries. Callers must have authorized
 * the request first: a cache hit skips the query, not the access check.
 */
function through<T>(
  endpoint: string,
  request: MetricQueryRequest,
  extra: string,
  run: (query: MetricQueryRequest) => Promise<T>
): Promise<T> {
  const query = normalizeRequest(request);
  return cached(cacheKey(endpoint, query, extra), ttlSecondsFor(Date.parse(query.dateRange.to)), () => run(query));
}

export const cachedOverview = (request: MetricQueryRequest) => through("overview", request, "v2", getOverviewMetrics);

export const cachedBreakdown = (request: MetricQueryRequest, dimension: BreakdownDimension) =>
  through("breakdown", request, `${dimension}:v2`, (query) => getBreakdown(query, dimension));

export const cachedWebVitals = (request: MetricQueryRequest) => through("vitals", request, "", getWebVitalsSummary);

export const cachedTimeSeries = (request: MetricQueryRequest) =>
  through("timeseries", request, `${request.dateRange.granularity}:v3`, getTimeSeries);

export const cachedJourneys = (request: MetricQueryRequest) => through("journeys", request, "", getTopJourneys);

export const cachedCampaigns = (request: MetricQueryRequest) => through("campaigns", request, "", getCampaignBreakdown);

/** Flow diagram data: shaped before caching so the cached value is small and ready to draw. */
export const cachedJourneyGraph = (request: MetricQueryRequest) =>
  through("jflow", request, "v1", async (query) => buildFlowGraph(await getJourneyFlowRows(query)));

export const cachedJourneyRoutes = (request: MetricQueryRequest, limit: number) =>
  through("jroutes", request, `v1:${limit}`, (query) => getJourneyRoutes(query, limit));

export const cachedJourneyTrace = (request: MetricQueryRequest, route: string[]) =>
  through("jtrace", request, `v1:${route.join("")}`, async (query) =>
    buildTrace(route, await getJourneyTraceRows(query, route))
  );

export const cachedJourneySegments = (request: MetricQueryRequest, segment: JourneySegment) =>
  through("jseg", request, `v1:${segment}`, async (query) => {
    const { reach, totals } = await getJourneySegmentRows(query, segment);
    return buildSegmentTable(reach, totals);
  });

/** The same flow, trimmed for the Overview: four steps, the top three pages in each. */
export const cachedJourneyGraphCompact = (request: MetricQueryRequest) =>
  through("jflow", request, "v1:compact", async (query) => buildFlowGraph(await getJourneyFlowRows(query), 3, 4));

export const cachedPageEngagement = (request: MetricQueryRequest, limit: number) =>
  through("pageeng", request, `v1:${limit}`, (query) => getPageEngagement(query, limit));

export const cachedVitalsByPage = (request: MetricQueryRequest, limit: number) =>
  through("vitalspage", request, `v1:${limit}`, (query) => getWebVitalsByPage(query, limit));
