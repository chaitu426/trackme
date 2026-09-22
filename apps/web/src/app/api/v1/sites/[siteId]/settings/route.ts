import { randomBytes } from "node:crypto";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError, type SiteSettings } from "@trackme/contracts";
import { requireSiteAccess, updateSiteSettings } from "@/lib/tenancy";
import { recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/http";

function omitUndefined<T extends Record<string, unknown>>(
  obj: T
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

const PatchSchema = z.object({
  collectWebVitals: z.boolean().optional(),
  respectDoNotTrack: z.boolean().optional(),
  allowLocalhostTracking: z.boolean().optional(),
  retentionMonths: z.number().int().min(1).max(60).optional(),
  publicDashboardEnabled: z.boolean().optional(),
  requireOriginMatch: z.boolean().optional(),
  requireConsent: z.boolean().optional(),
  signingRequired: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const { site } = await requireSiteAccess(request, siteId);
    return NextResponse.json({
      site: {
        id: site.id,
        domain: site.domain,
        displayName: site.displayName,
        publicKey: site.publicKey,
      },
      settings: site.settings,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const { site, ctx } = await requireSiteAccess(request, siteId, "sites:update");

    const parsed = PatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "Invalid site settings payload");
    }

    const patch: Partial<SiteSettings> = omitUndefined(parsed.data);
    if (patch.publicDashboardEnabled && !site.settings.publicDashboardSlug) {
      patch.publicDashboardSlug = randomBytes(6).toString("base64url");
    }

    const updated = await updateSiteSettings(siteId, patch);

    await recordAuditLog({
      workspaceId: site.workspaceId,
      actorId: ctx.userId,
      action: "site_settings:update",
      targetType: "site",
      targetId: site.id,
      metadata: patch as Record<string, unknown>,
      ipAddress: request.headers.get("x-forwarded-for") || null,
    });

    return NextResponse.json({ settings: updated.settings });
  } catch (error) {
    return jsonError(error);
  }
}
