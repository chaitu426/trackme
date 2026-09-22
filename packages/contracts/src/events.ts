import { z } from "zod";

/**
 * Approved UTM campaign dimensions
 */
export const CampaignSchema = z.object({
  source: z.string().max(128).optional(),
  medium: z.string().max(128).optional(),
  campaign: z.string().max(128).optional(),
  term: z.string().max(128).optional(),
  content: z.string().max(128).optional(),
});

export type Campaign = z.infer<typeof CampaignSchema>;

/**
 * Safe custom event property values (scalars only - strictly prevent deeply nested structures)
 */
export const EventPropertyValueSchema = z.union([
  z.string().max(256),
  z.number().finite(),
  z.boolean(),
]);

export const EventPropertiesSchema = z
  .record(
    z.string().max(64).regex(/^[a-zA-Z0-9_.-]+$/, "Property keys must be alphanumeric"),
    EventPropertyValueSchema
  )
  .refine((obj) => Object.keys(obj).length <= 50, {
    message: "Maximum 50 custom properties allowed per event",
  });

export type EventProperties = z.infer<typeof EventPropertiesSchema>;

/**
 * Core Web Vitals metric payload schema
 */
export const WebVitalMetricSchema = z.object({
  name: z.enum(["CLS", "FCP", "FID", "INP", "LCP", "TTFB"]),
  value: z.number().nonnegative(),
  rating: z.enum(["good", "needs-improvement", "poor"]),
  navigationType: z.string().max(64).optional(),
});

export type WebVitalMetric = z.infer<typeof WebVitalMetricSchema>;

/**
 * Base versioned tracker event envelope (Schema Version 1)
 */
export const TrackerEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid("eventId must be a valid UUIDv4"),
  type: z.enum(["pageview", "custom", "web_vital"]),
  occurredAt: z.string().datetime({ message: "occurredAt must be an ISO 8601 UTC timestamp" }),
  siteKey: z.string().min(8).max(64),
  sessionId: z.string().min(8).max(64),
  visitorPseudonym: z.string().min(8).max(64),
  url: z.string().url().max(2048),
  path: z.string().max(512),
  title: z.string().max(512).optional(),
  referrer: z.string().max(2048).optional(),
  campaign: CampaignSchema.optional(),
  properties: EventPropertiesSchema.optional(),
  webVital: WebVitalMetricSchema.optional(),
});

export type TrackerEvent = z.infer<typeof TrackerEventSchema>;

/**
 * Ingestion batch request payload
 */
export const IngestionBatchRequestSchema = z.object({
  events: z
    .array(TrackerEventSchema)
    .min(1, "Batch must contain at least 1 event")
    .max(50, "Batch size exceeds maximum limit of 50 events"),
});

export type IngestionBatchRequest = z.infer<typeof IngestionBatchRequestSchema>;

/**
 * Enriched event envelope ready for ClickHouse insertion
 */
export const EnrichedEventSchema = TrackerEventSchema.extend({
  workspaceId: z.string().uuid(),
  siteId: z.string().uuid(),
  receivedAt: z.string().datetime(),
  country: z.string().length(2).optional(), // ISO 3166-1 alpha-2
  city: z.string().max(128).optional(),
  browser: z.string().max(64).optional(),
  os: z.string().max(64).optional(),
  device: z.enum(["desktop", "mobile", "tablet", "bot", "unknown"]),
  isBot: z.boolean().default(false),
  botStatus: z.enum(["human", "known_bot", "heuristic_bot", "rate_limited"]).default("human"),
});

export type EnrichedEvent = z.infer<typeof EnrichedEventSchema>;

