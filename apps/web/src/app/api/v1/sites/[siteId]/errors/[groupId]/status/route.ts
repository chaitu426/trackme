import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError, ERROR_ACTIONS } from "@trackme/contracts";
import { getErrorReleaseBreakdown } from "@trackme/analytics";
import { requireSiteAccess } from "@/lib/tenancy";
import { applyErrorAction } from "@/lib/error-status";
import { recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";
import { getClientIp } from "@/lib/client-ip";

const BodySchema = z.object({ action: z.enum(ERROR_ACTIONS as [string, ...string[]]) });
const GROUP_ID = /^\d{1,20}$/;
const day = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);

/** Resolve, ignore or reopen one error issue. Needs permission to update the site (members and above). */
async function handlePatch(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string; groupId: string }> }
) {
  try {
    const { siteId, groupId } = await params;
    const { ctx, site } = await requireSiteAccess(request, siteId, "sites:update");
    if (!GROUP_ID.test(groupId)) throw new AppError(400, "INVALID_INPUT", "Invalid issue id");

    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError(400, "INVALID_INPUT", `action must be one of ${ERROR_ACTIONS.join(", ")}`);
    const action = parsed.data.action as (typeof ERROR_ACTIONS)[number];

    // "Resolve in next release" needs the builds the issue has appeared in, to tell a comeback from old clients.
    const releasesSeen =
      action === "resolve_next_release"
        ? (await getErrorReleaseBreakdown(site.id, groupId, day(90 * 86_400_000), day(0))).map((slice) => slice.release)
        : [];

    const actor = ctx.userId.startsWith("api-key:") ? null : ctx.userId;
    const state = await applyErrorAction({ siteId: site.id, groupId, action, userId: actor, releasesSeen });

    await recordAuditLog({
      workspaceId: site.workspaceId,
      actorId: actor,
      action: `error:${action}`,
      targetType: "error_group",
      targetId: groupId,
      metadata: { siteId: site.id },
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ status: state.status, mode: state.mode });
  } catch (error) {
    return jsonError(error);
  }
}

export const PATCH = timedRoute("error_status", handlePatch);
