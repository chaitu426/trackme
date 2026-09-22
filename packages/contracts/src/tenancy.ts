import { z } from "zod";

export const WorkspaceRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const ApiKeyScopeSchema = z.enum([
  "read:analytics",
  "write:events",
  "admin:workspace",
]);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

export const PlanTierSchema = z.enum(["starter", "growth", "scale", "enterprise"]);
export type PlanTier = z.infer<typeof PlanTierSchema>;

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(64),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
  plan: PlanTierSchema.default("starter"),
  timezone: z.string().default("UTC"),
  dataRegion: z.enum(["eu-central-1", "us-east-1"]).default("eu-central-1"),
  monthlyEventQuota: z.number().int().positive().default(100_000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const SiteSettingsSchema = z.object({
  collectWebVitals: z.boolean().default(true),
  respectDoNotTrack: z.boolean().default(true),
  allowLocalhostTracking: z.boolean().default(false),
  retentionMonths: z.number().int().min(1).max(60).default(24),
  publicDashboardEnabled: z.boolean().default(false),
  publicDashboardSlug: z.string().optional(),
  /** Reject requests whose Origin/Referer host does not match the site domain. */
  requireOriginMatch: z.boolean().default(true),
  /** Tracker must receive explicit consent before sending events. */
  requireConsent: z.boolean().default(false),
  /**
   * When true, ingest requires X-GI-Signature = hex(HMAC-SHA256(secret, rawBody)).
   * Prefer injecting the secret via a first-party proxy — never ship it on a public CDN page.
   */
  signingRequired: z.boolean().default(false),
  /** Server-only ingest HMAC secret (stripped from client-facing API responses). */
  signingSecret: z.string().min(16).max(128).optional(),
  /** SHA-256 hex of signingSecret for audit / "is configured" checks. */
  signingSecretHash: z.string().optional(),
});
export type SiteSettings = z.infer<typeof SiteSettingsSchema>;

export const SiteSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  domain: z.string().min(3).max(255),
  displayName: z.string().min(1).max(128),
  publicKey: z.string().min(16).max(64),
  settings: SiteSettingsSchema.default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Site = z.infer<typeof SiteSchema>;

export const GoalTypeSchema = z.enum(["pageview_rule", "custom_event"]);
export type GoalType = z.infer<typeof GoalTypeSchema>;

export const GoalRuleSchema = z.object({
  type: GoalTypeSchema,
  eventName: z.string().optional(),
  pathPattern: z.string().optional(),
  targetValue: z.number().optional(),
});
export type GoalRule = z.infer<typeof GoalRuleSchema>;

