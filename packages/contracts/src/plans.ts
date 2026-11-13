import { z } from "zod";

/**
 * The plans and what each allows: the single source of truth. Routes, the edge quota and the UI all read this;
 * nothing else hard-codes a limit. `null` means unlimited.
 */
export const PlanIdSchema = z.enum(["free", "pro"]);
export type PlanId = z.infer<typeof PlanIdSchema>;

export interface PlanLimits {
  /** Workspaces in one company. */
  workspaces: number | null;
  /** Websites across the whole company. */
  sites: number | null;
  /** Events counted per month across the company's workspaces, before the grace margin. */
  eventsPerMonth: number;
  /** Extra events accepted past the limit, in percent. 0 means a hard cap. */
  eventGracePercent: number;
  /** People with the owner, admin or member role in one workspace (pending invites count). */
  members: number | null;
  /** People with the viewer role in one workspace (pending invites count). */
  viewers: number | null;
  /** Teams and per-site feature access. */
  teams: boolean;
  retentionMonths: number;
  /** Error tracking and releases: how many sites may use them. */
  errorTrackingSites: number | null;
  paymentsAnalytics: boolean;
  /** Per workspace. */
  funnels: number | null;
  goals: number | null;
  segments: number | null;
  apiKeys: number | null;
  alertRules: number | null;
  alertChannels: number | null;
  /** Channel kinds the plan may create. */
  alertChannelTypes: readonly ("email" | "slack" | "discord" | "webhook")[];
  askPerMonth: number;
  publicDashboard: boolean;
  auditLog: boolean;
  fullExports: boolean;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    workspaces: 1,
    sites: 1,
    eventsPerMonth: 50_000,
    eventGracePercent: 0,
    members: 2,
    viewers: 2,
    teams: false,
    retentionMonths: 6,
    errorTrackingSites: 1,
    paymentsAnalytics: false,
    funnels: 1,
    goals: 3,
    segments: 1,
    apiKeys: 1,
    alertRules: 1,
    alertChannels: 1,
    alertChannelTypes: ["email"],
    askPerMonth: 20,
    publicDashboard: false,
    auditLog: false,
    fullExports: false,
  },
  pro: {
    workspaces: 3,
    sites: 10,
    eventsPerMonth: 1_000_000,
    eventGracePercent: 20,
    members: 10,
    viewers: null,
    teams: true,
    retentionMonths: 24,
    errorTrackingSites: null,
    paymentsAnalytics: true,
    funnels: null,
    goals: null,
    segments: null,
    apiKeys: 10,
    alertRules: null,
    alertChannels: null,
    alertChannelTypes: ["email", "slack", "discord", "webhook"],
    askPerMonth: 500,
    publicDashboard: true,
    auditLog: true,
    fullExports: true,
  },
};

export function limitsFor(plan: string): PlanLimits {
  const parsed = PlanIdSchema.safeParse(plan);
  return PLANS[parsed.success ? parsed.data : "free"];
}

/** What the edge enforces per month: the limit plus the plan's grace margin (0 for a hard cap). */
export function eventQuotaFor(plan: string): number {
  const limits = limitsFor(plan);
  return Math.floor(limits.eventsPerMonth * (1 + limits.eventGracePercent / 100));
}

/** The countable things a plan limits. */
export type LimitedResource =
  | "workspaces"
  | "sites"
  | "members"
  | "viewers"
  | "funnels"
  | "goals"
  | "segments"
  | "apiKeys"
  | "alertRules"
  | "alertChannels"
  | "askRuns";

const RESOURCE_LABEL: Record<LimitedResource, string> = {
  workspaces: "workspaces",
  sites: "websites",
  members: "members",
  viewers: "viewers",
  funnels: "funnels",
  goals: "goals",
  segments: "segments",
  apiKeys: "API keys",
  alertRules: "alert rules",
  alertChannels: "alert channels",
  askRuns: "Ask questions this month",
};

export function resourceLabel(resource: LimitedResource): string {
  return RESOURCE_LABEL[resource];
}

/** The plan's cap for a resource, or null when unlimited. */
export function limitOf(plan: string, resource: LimitedResource): number | null {
  const limits = limitsFor(plan);
  return resource === "askRuns" ? limits.askPerMonth : limits[resource];
}

/** The plan to suggest when a limit is hit: the next one up, or null when already on the top plan. */
export function upgradeTarget(plan: string): PlanId | null {
  return limitsFor(plan) === PLANS.free ? "pro" : null;
}

/** Whether one more of a resource fits: `current` is how many exist now. */
export function canAdd(plan: string, resource: LimitedResource, current: number): boolean {
  const cap = limitOf(plan, resource);
  return cap === null || current < cap;
}
