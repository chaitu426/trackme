import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError, ENVIRONMENTS, ReleaseSchema } from "@trackme/contracts";
import { and, db, eq, siteReleases, sites } from "@trackme/db";
import { authenticateDeployKey } from "@/lib/tenancy";
import { recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import { getClientIp } from "@/lib/client-ip";
import { timedRoute } from "@/lib/metrics-registry";

/** A deploy may be reported late, but not from the future (clock skew allowance) or from long ago. */
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_SKEW_MS = 5 * 60 * 1000;

const DeploySchema = z.object({
  /** The site's public key, as in the tracker snippet. It names the site; the API key is what authorizes. */
  siteKey: z.string().min(8).max(64),
  version: ReleaseSchema,
  commit: z.string().regex(/^[A-Za-z0-9._-]{4,64}$/).optional(),
  environment: z.enum(ENVIRONMENTS).default("production"),
  deployedAt: z.string().datetime().optional(),
});

/**
 * Record a deploy. Idempotent per (site, version, environment): a CI retry returns the original row.
 * Authorizes with a workspace API key holding `write:deploys`; the site must belong to that workspace.
 */
async function handlePost(request: NextRequest) {
  try {
    const { workspaceId, keyId } = await authenticateDeployKey(request);

    const parsed = DeploySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "siteKey and version are required; see docs/releases.md for the body");
    }
    const { siteKey, version, commit, environment, deployedAt } = parsed.data;

    const deployed = deployedAt ? new Date(deployedAt) : new Date();
    const age = Date.now() - deployed.getTime();
    if (age > MAX_AGE_MS || age < -MAX_SKEW_MS) {
      throw new AppError(400, "INVALID_INPUT", "deployedAt must be within the last 90 days and not in the future");
    }

    const [site] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.publicKey, siteKey), eq(sites.workspaceId, workspaceId)))
      .limit(1);
    if (!site) {
      // Same answer whether the key does not exist or belongs to another workspace.
      throw new AppError(404, "SITE_NOT_FOUND", "No site with that siteKey in this workspace");
    }

    const [created] = await db
      .insert(siteReleases)
      .values({ siteId: site.id, version, commit: commit ?? null, environment, deployedAt: deployed })
      .onConflictDoNothing()
      .returning();

    if (created) {
      await recordAuditLog({
        workspaceId,
        action: "release:create",
        targetType: "site_release",
        targetId: created.id,
        metadata: { siteId: site.id, version, environment, keyId },
        ipAddress: getClientIp(request),
      });
      return NextResponse.json({ release: created, created: true }, { status: 201 });
    }

    const [existing] = await db
      .select()
      .from(siteReleases)
      .where(
        and(eq(siteReleases.siteId, site.id), eq(siteReleases.version, version), eq(siteReleases.environment, environment))
      )
      .limit(1);
    return NextResponse.json({ release: existing, created: false });
  } catch (error) {
    return jsonError(error);
  }
}

export const POST = timedRoute("deploys", handlePost);
