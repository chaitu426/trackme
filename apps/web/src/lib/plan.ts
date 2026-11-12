import {
  AppError,
  canAdd,
  limitOf,
  limitsFor,
  resourceLabel,
  upgradeTarget,
  type LimitedResource,
  type PlanLimits,
} from "@trackme/contracts";
import {
  db,
  companies,
  workspaces,
  workspaceMembers,
  workspaceInvites,
  sites,
  goals,
  siteFunnels,
  siteSegments,
  apiKeys,
  alertChannels,
  alertRules,
  askRuns,
  eq,
  and,
  gt,
  gte,
  inArray,
  sql,
} from "@trackme/db";

/** A database handle inside `db.transaction`. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Roles that take a "member" seat; viewers have their own, separate allowance. */
const MEMBER_SEAT_ROLES = ["owner", "admin", "member"] as const;

/** The seat a role occupies: `members` for owner/admin/member, `viewers` for viewer. */
export function seatFor(role: string): "members" | "viewers" {
  return role === "viewer" ? "viewers" : "members";
}

export function planLimitError(plan: string, resource: LimitedResource, current: number): AppError {
  const limit = limitOf(plan, resource);
  const upgradeTo = upgradeTarget(plan);
  const what = resourceLabel(resource);
  const detail =
    limit === null
      ? `Your ${plan} plan does not include ${what}.`
      : `Your ${plan} plan allows ${limit} ${what}. ${upgradeTo ? `Upgrade to ${upgradeTo} to add more.` : "You are at the top plan's limit."}`;
  return new AppError(402, "PLAN_LIMIT", detail, { plan, resource, limit, current, upgradeTo });
}

type BooleanFeature = {
  [K in keyof PlanLimits]: PlanLimits[K] extends boolean ? K : never;
}[keyof PlanLimits];

const FEATURE_LABEL: Record<BooleanFeature, string> = {
  teams: "Teams and per-site access",
  paymentsAnalytics: "Payments analytics",
  publicDashboard: "Public dashboards",
  auditLog: "The audit log",
  fullExports: "Full exports",
};

/** Throws a 402 when the plan does not include a feature. */
export function assertFeature(plan: string, feature: BooleanFeature): void {
  if (!limitsFor(plan)[feature]) {
    throw new AppError(402, "PLAN_FEATURE", `${FEATURE_LABEL[feature]} is not included in your ${plan} plan.`, {
      plan,
      resource: feature,
      limit: null,
      current: 0,
      upgradeTo: upgradeTarget(plan),
    });
  }
}

/** Throws a 402 when the plan may not create this kind of alert channel. */
export function assertChannelType(plan: string, type: string): void {
  const allowed = limitsFor(plan).alertChannelTypes as readonly string[];
  if (!allowed.includes(type)) {
    throw new AppError(402, "PLAN_FEATURE", `${type} alert channels are not included in your ${plan} plan.`, {
      plan,
      resource: `alert_channel:${type}`,
      limit: null,
      current: 0,
      upgradeTo: upgradeTarget(plan),
    });
  }
}

/** The company and plan a workspace belongs to. */
export async function planOfWorkspace(workspaceId: string, client: Tx | typeof db = db): Promise<{ companyId: string; plan: string }> {
  const [row] = await client
    .select({ companyId: companies.id, plan: companies.plan })
    .from(workspaces)
    .innerJoin(companies, eq(companies.id, workspaces.companyId))
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!row) {
    throw new AppError(404, "WORKSPACE_NOT_FOUND", "Workspace not found.");
  }
  return row;
}

/** The plan limits that apply to a site, through its workspace's company. */
export async function planOfSite(siteId: string): Promise<{ companyId: string; workspaceId: string; plan: string }> {
  const [row] = await db
    .select({ companyId: companies.id, workspaceId: workspaces.id, plan: companies.plan })
    .from(sites)
    .innerJoin(workspaces, eq(workspaces.id, sites.workspaceId))
    .innerJoin(companies, eq(companies.id, workspaces.companyId))
    .where(eq(sites.id, siteId))
    .limit(1);
  if (!row) {
    throw new AppError(404, "SITE_NOT_FOUND", "Site not found.");
  }
  return row;
}

function startOfUtcMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function n(query: PromiseLike<{ n: number }[]>): Promise<number> {
  return (await query)[0]?.n ?? 0;
}

/** How many of a resource exist right now, in the scope the plan counts it in. */
export async function countResource(
  tx: Tx,
  resource: LimitedResource,
  scope: { companyId: string; workspaceId?: string | undefined }
): Promise<number> {
  const count = sql<number>`count(*)::int`;
  const workspaceId = scope.workspaceId;
  const needWorkspace = () => {
    if (!workspaceId) throw new Error(`countResource(${resource}) needs a workspaceId`);
    return workspaceId;
  };

  switch (resource) {
    case "workspaces":
      return n(tx.select({ n: count }).from(workspaces).where(eq(workspaces.companyId, scope.companyId)));
    case "sites":
      return n(
        tx
          .select({ n: count })
          .from(sites)
          .innerJoin(workspaces, eq(workspaces.id, sites.workspaceId))
          .where(eq(workspaces.companyId, scope.companyId))
      );
    case "members":
    case "viewers": {
      const ws = needWorkspace();
      const roles = resource === "viewers" ? (["viewer"] as const) : MEMBER_SEAT_ROLES;
      const people = await n(
        tx
          .select({ n: count })
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, ws), inArray(workspaceMembers.role, [...roles])))
      );
      // A pending invitation holds the seat it was sent for.
      const pending = await n(
        tx
          .select({ n: count })
          .from(workspaceInvites)
          .where(
            and(
              eq(workspaceInvites.workspaceId, ws),
              eq(workspaceInvites.status, "pending"),
              gt(workspaceInvites.expiresAt, new Date()),
              inArray(workspaceInvites.role, [...roles])
            )
          )
      );
      return people + pending;
    }
    case "funnels":
      return n(
        tx
          .select({ n: count })
          .from(siteFunnels)
          .innerJoin(sites, eq(sites.id, siteFunnels.siteId))
          .where(eq(sites.workspaceId, needWorkspace()))
      );
    case "segments":
      return n(
        tx
          .select({ n: count })
          .from(siteSegments)
          .innerJoin(sites, eq(sites.id, siteSegments.siteId))
          .where(eq(sites.workspaceId, needWorkspace()))
      );
    case "goals":
      return n(tx.select({ n: count }).from(goals).where(eq(goals.workspaceId, needWorkspace())));
    case "apiKeys":
      return n(tx.select({ n: count }).from(apiKeys).where(eq(apiKeys.workspaceId, needWorkspace())));
    case "alertChannels":
      return n(tx.select({ n: count }).from(alertChannels).where(eq(alertChannels.workspaceId, needWorkspace())));
    case "alertRules":
      return n(
        tx
          .select({ n: count })
          .from(alertRules)
          .innerJoin(sites, eq(sites.id, alertRules.siteId))
          .where(eq(sites.workspaceId, needWorkspace()))
      );
    case "askRuns":
      return n(
        tx
          .select({ n: count })
          .from(askRuns)
          .where(and(eq(askRuns.workspaceId, needWorkspace()), gte(askRuns.createdAt, startOfUtcMonth())))
      );
  }
}

export interface PlanLimitOptions {
  resource: LimitedResource;
  /** Required for every resource except `workspaces` and `sites`, which count across the company. */
  workspaceId?: string;
  /** Required when `workspaceId` is not given. */
  companyId?: string;
  /**
   * Runs after the company is locked and before the count, in the same transaction. For changes that alter
   * the count, such as revoking the pending invitation that a re-send replaces.
   */
  prepare?: (tx: Tx) => Promise<void>;
}

/**
 * Locks the company, then checks the plan has room for one more of a resource. Call it inside a transaction, before
 * the insert, so the count and the insert are atomic. Returns the plan so callers can use it.
 */
export async function assertRoom(
  tx: Tx,
  options: PlanLimitOptions & { companyId: string }
): Promise<string> {
  const [company] = await tx
    .select({ plan: companies.plan })
    .from(companies)
    .where(eq(companies.id, options.companyId))
    .for("update")
    .limit(1);
  if (!company) {
    throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found.");
  }

  if (options.prepare) await options.prepare(tx);

  const current = await countResource(tx, options.resource, { companyId: options.companyId, workspaceId: options.workspaceId });
  if (!canAdd(company.plan, options.resource, current)) {
    throw planLimitError(company.plan, options.resource, current);
  }
  return company.plan;
}

/**
 * Creates something only if the plan has room for it. The company row is locked for the whole transaction, so two
 * requests racing for the last slot are serialised: one gets it, the other gets a PLAN_LIMIT error.
 */
export async function withPlanLimit<T>(options: PlanLimitOptions, create: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    let companyId = options.companyId;
    if (!companyId) {
      if (!options.workspaceId) throw new Error("withPlanLimit needs a workspaceId or a companyId");
      companyId = (await planOfWorkspace(options.workspaceId, tx)).companyId;
    }
    await assertRoom(tx, { ...options, companyId });
    return create(tx);
  });
}
