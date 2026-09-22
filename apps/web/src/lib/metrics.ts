import type { MetricQueryRequest } from "@trackme/contracts";

export function buildMetricRequest(
  workspaceId: string,
  siteId: string,
  dateRange: { from: string; to: string },
  options: { limit?: number; offset?: number } = {}
): MetricQueryRequest {
  return {
    workspaceId,
    siteId,
    dateRange: { from: dateRange.from, to: dateRange.to, granularity: "day" },
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
  };
}
