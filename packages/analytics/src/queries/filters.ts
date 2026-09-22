import { DimensionFilter } from "@trackme/contracts";

const FILTER_COLUMNS: Record<keyof DimensionFilter, string> = {
  path: "path",
  referrer: "referrer",
  source: "campaign_source",
  medium: "campaign_medium",
  campaign: "campaign_name",
  country: "country",
  browser: "browser",
  os: "os",
  device: "device",
};

/**
 * Turns an optional DimensionFilter into a parameterized SQL fragment.
 * Every ClickHouse query that accepts a MetricQueryRequest must apply this -
 * otherwise `filters` on the request silently does nothing.
 */
export function buildDimensionFilterSql(filters: DimensionFilter | undefined): {
  clause: string;
  params: Record<string, string>;
} {
  if (!filters) {
    return { clause: "", params: {} };
  }

  const clauses: string[] = [];
  const params: Record<string, string> = {};

  for (const [key, column] of Object.entries(FILTER_COLUMNS) as [keyof DimensionFilter, string][]) {
    const value = filters[key];
    if (value === undefined || value === "") {
      continue;
    }
    const paramName = `filter_${String(key)}`;
    clauses.push(`${column} = {${paramName}:String}`);
    params[paramName] = value;
  }

  return {
    clause: clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "",
    params,
  };
}
