import { z } from "zod";

export const GranularitySchema = z.enum(["minute", "hour", "day", "month"]);
export type Granularity = z.infer<typeof GranularitySchema>;

/** Longest span one request may cover, and the most points one series may return. */
export const MAX_RANGE_DAYS = 366;
export const MAX_SERIES_POINTS = 5_000;
const BUCKET_MS: Record<Granularity, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000, month: 31 * 86_400_000 };

/**
 * An unbounded range let any API-key caller ask for ten years of minute-level data: one request that
 * either reads hundreds of millions of rows or is thrown out by ClickHouse after taking a query slot.
 * Reject it at the door instead: from <= to, at most MAX_RANGE_DAYS, and at most MAX_SERIES_POINTS
 * buckets at the requested granularity (so "minute" is limited to a few days, "hour" to about 7 months).
 */
export const DateRangeSchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    granularity: GranularitySchema.default("day"),
  })
  .refine((r) => Date.parse(r.to) >= Date.parse(r.from), { message: "`to` must not be before `from`" })
  .refine((r) => Date.parse(r.to) - Date.parse(r.from) <= MAX_RANGE_DAYS * 86_400_000, {
    message: `Date range cannot exceed ${MAX_RANGE_DAYS} days`,
  })
  .refine((r) => (Date.parse(r.to) - Date.parse(r.from)) / BUCKET_MS[r.granularity] <= MAX_SERIES_POINTS, {
    message: `Too many data points for this granularity; use a coarser granularity or a shorter range`,
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

