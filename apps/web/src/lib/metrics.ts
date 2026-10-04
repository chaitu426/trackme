import type { DimensionFilter, Granularity, MetricQueryRequest } from "@trackme/contracts";

export function buildMetricRequest(
  workspaceId: string,
  siteId: string,
  dateRange: { from: string; to: string },
  options: { limit?: number; offset?: number; filters?: DimensionFilter; granularity?: Granularity } = {}
): MetricQueryRequest {
  return {
    workspaceId,
    siteId,
    dateRange: { from: dateRange.from, to: dateRange.to, granularity: options.granularity ?? "day" },
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    filters: options.filters,
  };
}
