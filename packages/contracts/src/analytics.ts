import { z } from "zod";

export const GranularitySchema = z.enum(["minute", "hour", "day", "month"]);
export type Granularity = z.infer<typeof GranularitySchema>;

export const DateRangeSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  granularity: GranularitySchema.default("day"),
});
export type DateRange = z.infer<typeof DateRangeSchema>;

export const DimensionFilterSchema = z.object({
  path: z.string().optional(),
  referrer: z.string().optional(),
  source: z.string().optional(),
  medium: z.string().optional(),
  campaign: z.string().optional(),
  country: z.string().optional(),
  browser: z.string().optional(),
  os: z.string().optional(),
  device: z.enum(["desktop", "mobile", "tablet", "bot", "unknown"]).optional(),
});
export type DimensionFilter = z.infer<typeof DimensionFilterSchema>;

export const MetricQueryRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  siteId: z.string().uuid(),
  dateRange: DateRangeSchema,
  filters: DimensionFilterSchema.optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
});
export type MetricQueryRequest = z.infer<typeof MetricQueryRequestSchema>;

export const OverviewMetricsResponseSchema = z.object({
  siteId: z.string().uuid(),
  dateRange: DateRangeSchema,
  visitors: z.number().nonnegative(),
  sessions: z.number().nonnegative(),
  pageviews: z.number().nonnegative(),
  bounceRatePercentage: z.number().min(0).max(100),
  avgDurationSeconds: z.number().nonnegative(),
  activeVisitorsNow: z.number().nonnegative(),
});
export type OverviewMetricsResponse = z.infer<typeof OverviewMetricsResponseSchema>;

export const DimensionItemSchema = z.object({
  name: z.string(),
  visitors: z.number().nonnegative(),
  pageviews: z.number().nonnegative(),
  percentage: z.number().min(0).max(100),
});
export type DimensionItem = z.infer<typeof DimensionItemSchema>;

export const BreakdownResponseSchema = z.object({
  dimension: z.string(),
  total: z.number().nonnegative(),
  items: z.array(DimensionItemSchema),
});
export type BreakdownResponse = z.infer<typeof BreakdownResponseSchema>;

