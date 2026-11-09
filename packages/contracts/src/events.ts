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

/** Every event kind the pipeline accepts. Kinds after `engagement` belong to the observability suites. */
export const EVENT_TYPES = [
  "pageview",
  "custom",
  "web_vital",
  "identify",
  "engagement",
  "error",
  "api_call",
  "payment",
  "flag_exposure",
  "feedback",
  "heartbeat",
  "deploy",
] as const;

export const ENVIRONMENTS = ["production", "staging", "development"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Release label from the tracker config: a version, tag or short commit. */
export const ReleaseSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+@/-]*$/, "release may use letters, digits and . _ + @ / -");

export const ERROR_LEVELS = ["fatal", "error", "warning", "info"] as const;
export const BREADCRUMB_KINDS = ["navigation", "click", "fetch", "log"] as const;

/** Size caps for the error payload. The Go edge enforces the same numbers (internal/validate). */
export const ERROR_LIMITS = {
  type: 128,
  message: 1024,
  fingerprint: 128,
  frames: 50,
  frameFn: 200,
  frameFile: 512,
  breadcrumbs: 20,
  breadcrumbText: 200,
  tags: 10,
  tagKey: 32,
  tagValue: 200,
} as const;

export const ErrorFrameSchema = z.object({
  fn: z.string().max(ERROR_LIMITS.frameFn).optional(),
  file: z.string().min(1).max(ERROR_LIMITS.frameFile),
  line: z.number().int().nonnegative().optional(),
  col: z.number().int().nonnegative().optional(),
  inApp: z.boolean().optional(),
});

export const BreadcrumbSchema = z.object({
  /** Epoch milliseconds. */
  ts: z.number().int().nonnegative(),
  k: z.enum(BREADCRUMB_KINDS),
  /** Already scrubbed by the SDK: `GET /api/orders 500 120ms`, `click button#pay "Pay now"`. */
  m: z.string().max(ERROR_LIMITS.breadcrumbText),
});

/**
 * An error report. Lives beside `properties` rather than inside it because properties are scalar-only
 * with 256-character values, which a stack trace and breadcrumbs do not fit.
 */
export const ErrorPayloadSchema = z.object({
  type: z.string().min(1).max(ERROR_LIMITS.type),
  message: z.string().max(ERROR_LIMITS.message),
  level: z.enum(ERROR_LEVELS).optional(),
  /** Custom grouping key; overrides the computed fingerprint. */
  fingerprint: z.string().min(1).max(ERROR_LIMITS.fingerprint).optional(),
  frames: z.array(ErrorFrameSchema).max(ERROR_LIMITS.frames).optional(),
  breadcrumbs: z.array(BreadcrumbSchema).max(ERROR_LIMITS.breadcrumbs).optional(),
  tags: z
    .record(z.string().min(1).max(ERROR_LIMITS.tagKey).regex(/^[a-zA-Z0-9_.-]+$/), z.string().max(ERROR_LIMITS.tagValue))
    .refine((tags) => Object.keys(tags).length <= ERROR_LIMITS.tags, { message: "At most 10 tags" })
    .optional(),
});
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

/** An `error` event carries an `error` payload, and no other kind does. */
export function checkErrorKind(event: { type: string; error?: unknown }, ctx: z.RefinementCtx): void {
  if (event.type === "error" && event.error === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "An error event needs an error payload" });
  } else if (event.type !== "error" && event.error !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "Only error events carry an error payload" });
  }
}

/**
 * Base versioned tracker event envelope (Schema Version 1), before cross-field rules.
 * Use TrackerEventSchema; this exists so EnrichedEventSchema can extend it.
 */
const TrackerEventObject = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid("eventId must be a valid UUIDv4"),
  type: z.enum(EVENT_TYPES),
  occurredAt: z.string().datetime({ message: "occurredAt must be an ISO 8601 UTC timestamp" }),
  siteKey: z.string().min(8).max(64),
  sessionId: z.string().min(8).max(64),
  visitorPseudonym: z.string().min(8).max(64),
  tv: z.string().max(32).optional(),
  url: z.string().url().max(2048),
  path: z.string().max(512),
  title: z.string().max(512).optional(),
  referrer: z.string().max(2048).optional(),
  userId: z.string().max(256).optional(),
  release: ReleaseSchema.optional(),
  environment: z.enum(ENVIRONMENTS).optional(),
  userTraits: EventPropertiesSchema.optional(),
  campaign: CampaignSchema.optional(),
  properties: EventPropertiesSchema.optional(),
  webVital: WebVitalMetricSchema.optional(),
  error: ErrorPayloadSchema.optional(),
});

export const TrackerEventSchema = TrackerEventObject.superRefine(checkErrorKind);

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
export const EnrichedEventSchema = TrackerEventObject.extend({
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
}).superRefine(checkErrorKind);

export type EnrichedEvent = z.infer<typeof EnrichedEventSchema>;

