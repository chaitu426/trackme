import { z } from "zod";
import type { WorkspaceRole } from "./tenancy.js";

/**
 * Per-site feature access: which parts of the product a person may use on a site. This file is the whole rule, as pure
 * functions, so the server, the sidebar and the access screen can never disagree about who sees what.
 */
export const FEATURES = ["acquisition", "funnels", "people", "errors", "releases", "payments", "ask", "site_settings"] as const;
export const FeatureSchema = z.enum(FEATURES);
export type Feature = z.infer<typeof FeatureSchema>;

export const AccessLevelSchema = z.enum(["view", "manage"]);
export type AccessLevel = z.infer<typeof AccessLevelSchema>;

export const AccessModeSchema = z.enum(["open", "restricted"]);
export type AccessMode = z.infer<typeof AccessModeSchema>;

export const FEATURE_INFO: Record<Feature, { label: string; description: string; teams: string }> = {
  acquisition: { label: "Traffic", description: "Overview, realtime, acquisition, geography and page performance", teams: "Marketing" },
  funnels: { label: "Funnels & goals", description: "Funnels, journeys, goals, events and retention", teams: "Marketing, Product" },
  people: { label: "User profiles", description: "People, their timelines and saved segments", teams: "Support, Product" },
  errors: { label: "Errors", description: "Error tracking and error groups", teams: "Engineering, QA" },
  releases: { label: "Releases & vitals", description: "Release impact and web vitals", teams: "Engineering" },
  payments: { label: "Payments", description: "Revenue, failures, refunds and gateways", teams: "Finance, Product" },
  ask: { label: "Ask", description: "Ask questions of the data in plain language", teams: "Anyone" },
  site_settings: { label: "Site settings", description: "Tracking snippet, privacy and keys for the site", teams: "Engineering" },
};

export interface FeatureGrant {
  feature: Feature;
  level: AccessLevel;
}

/** Where a person's access to a feature comes from, for the "why can they see this" panel. */
export type AccessSource = "role" | "team" | "person" | "none";

export interface AccessInput {
  role: WorkspaceRole;
  /** The workspace's access mode, already combined with the plan: only true when teams are in the plan. */
  restricted: boolean;
  grants: readonly FeatureGrant[];
}

const RANK: Record<AccessLevel, number> = { view: 1, manage: 2 };

/**
 * What a person may do with a feature on a site, or null for nothing.
 *
 * - Owners and admins always have everything.
 * - Without restrictions (the default, and always on the Free plan) the role decides, exactly as before teams existed.
 * - With restrictions only the person's grants count (their teams' plus their own, the highest wins).
 * - A grant never raises someone above their role: a viewer can only ever view, whatever they were granted. Whether a
 *   member may change something is still the role's permission; `manage` here only means the feature is not read-only.
 */
export function effectiveLevel(input: AccessInput, feature: Feature): AccessLevel | null {
  if (input.role === "owner" || input.role === "admin") return "manage";
  const cap: AccessLevel = input.role === "viewer" ? "view" : "manage";
  if (!input.restricted) return cap;

  let best: AccessLevel | null = null;
  for (const grant of input.grants) {
    if (grant.feature === feature && (best === null || RANK[grant.level] > RANK[best])) best = grant.level;
  }
  if (best === null) return null;
  return RANK[best] > RANK[cap] ? cap : best;
}

export const canView = (level: AccessLevel | null): boolean => level !== null;
export const canManageFeature = (level: AccessLevel | null): boolean => level === "manage";

/** The features a person has at least view access to on a site. */
export function visibleFeatures(input: AccessInput): Feature[] {
  return FEATURES.filter((f) => effectiveLevel(input, f) !== null);
}

/**
 * Which feature owns a dashboard path under a site (`errors`, `payments/leaks`, `settings`). Null for a path no feature
 * guards. One table, used by the section guards and by the sidebar.
 */
export function featureForSitePath(path: string): Feature | null {
  const first = path.split("/").filter(Boolean)[0] ?? "";
  switch (first) {
    case "overview":
    case "realtime":
    case "acquisition":
    case "geography":
    case "pages":
      return "acquisition";
    case "funnels":
    case "journeys":
    case "events":
    case "retention":
      return "funnels";
    case "people":
      return "people";
    case "errors":
      return "errors";
    case "releases":
    case "vitals":
      return "releases";
    case "payments":
      return "payments";
    case "settings":
      return "site_settings";
    default:
      return null;
  }
}

export const ACCESS_DENIED_CODE = "FEATURE_ACCESS_DENIED";

export interface AccessExplanation {
  feature: Feature;
  level: AccessLevel | null;
  source: AccessSource;
  /** The team names (or "Personal grant") that give this level, when it comes from grants. */
  via: string[];
}

export interface NamedGrant extends FeatureGrant {
  /** The team's name, or null for a grant made to the person directly. */
  team: string | null;
}

/**
 * Why a person has the access they have, per feature: from their role, from which teams, or from a personal grant. The
 * screen that answers "why can they see this?" is this function's output, so it cannot say something the rule does not.
 */
export function explainAccess(input: Omit<AccessInput, "grants">, grants: readonly NamedGrant[]): AccessExplanation[] {
  const resolved: AccessInput = { ...input, grants };
  return FEATURES.map((feature) => {
    const level = effectiveLevel(resolved, feature);
    if (level === null) return { feature, level, source: "none" as const, via: [] };
    if (input.role === "owner" || input.role === "admin" || !input.restricted) return { feature, level, source: "role" as const, via: [] };
    // The grants that reach the level the person ends up with (a viewer's manage grant is capped to view, and still counts).
    const reaching = grants.filter((g) => g.feature === feature && RANK[g.level] >= RANK[level]);
    const teamNames = reaching.flatMap((g) => (g.team ? [g.team] : []));
    const personal = reaching.some((g) => g.team === null);
    const via = [...new Set(teamNames), ...(personal ? ["Personal grant"] : [])];
    return { feature, level, source: teamNames.length > 0 ? ("team" as const) : ("person" as const), via };
  });
}
