import { NextRequest, NextResponse } from "next/server";
import { requireSiteAccess, rotateIngestSigningSecret } from "@/lib/tenancy";
import { recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/http";

/**
 * POST — rotate the ingest HMAC secret.
 * Returns plaintext once; store it in your first-party proxy env, not in public HTML.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const { site, ctx } = await requireSiteAccess(request, siteId, "sites:update");
    const result = await rotateIngestSigningSecret(siteId);

    await recordAuditLog({
      workspaceId: site.workspaceId,
      actorId: ctx.userId,
      action: "site_signing_secret:rotate",
      targetType: "site",
      targetId: site.id,
      metadata: { siteDomain: site.domain },
      ipAddress: request.headers.get("x-forwarded-for") || null,
    });

    return NextResponse.json({
      settings: result.site.settings,
      signingSecret: result.signingSecret,
      warning:
        "Copy this secret now. It is stored server-side only and will not be shown again. Prefer injecting it via a first-party reverse proxy.",
    });
  } catch (error) {
    return jsonError(error);
  }
}
