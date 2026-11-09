import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { GATEWAY_IDS } from "@trackme/payments";
import { and, db, eq, sitePaymentGateways } from "@trackme/db";
import { requireSiteAccess } from "@/lib/tenancy";
import { encryptSecret } from "@/lib/secret-box";
import { recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import { getClientIp } from "@/lib/client-ip";

const PutSchema = z.object({
  gateway: z.enum(GATEWAY_IDS),
  /** Only sent when setting or rotating; omitted to just enable/disable. */
  secret: z.string().min(8).max(256).optional(),
  enabled: z.boolean().optional(),
});

/** Connected gateways. The secret is never returned, only whether one is stored. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await params;
    await requireSiteAccess(request, siteId);
    const rows = await db
      .select({ gateway: sitePaymentGateways.gateway, enabled: sitePaymentGateways.enabled, lastEventAt: sitePaymentGateways.lastEventAt })
      .from(sitePaymentGateways)
      .where(eq(sitePaymentGateways.siteId, siteId));
    return NextResponse.json({ gateways: rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await params;
    const { site, ctx } = await requireSiteAccess(request, siteId, "sites:update");
    const parsed = PutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError(400, "INVALID_INPUT", "gateway is required; secret must be 8 to 256 characters");
    const { gateway, secret, enabled } = parsed.data;

    const [existing] = await db
      .select({ id: sitePaymentGateways.id })
      .from(sitePaymentGateways)
      .where(and(eq(sitePaymentGateways.siteId, siteId), eq(sitePaymentGateways.gateway, gateway)))
      .limit(1);

    if (!existing) {
      if (!secret) throw new AppError(400, "INVALID_INPUT", "A signing secret is required to connect a gateway");
      await db.insert(sitePaymentGateways).values({ siteId, gateway, secretEnc: encryptSecret(secret), enabled: enabled ?? true });
    } else {
      await db
        .update(sitePaymentGateways)
        .set({ ...(secret ? { secretEnc: encryptSecret(secret) } : {}), ...(enabled === undefined ? {} : { enabled }), updatedAt: new Date() })
        .where(eq(sitePaymentGateways.id, existing.id));
    }

    // The secret itself is never written to the audit log.
    await recordAuditLog({
      workspaceId: site.workspaceId,
      actorId: ctx.userId,
      action: "payment_gateway:upsert",
      targetType: "site",
      targetId: site.id,
      metadata: { gateway, secretChanged: Boolean(secret), enabled: enabled ?? null },
      ipAddress: getClientIp(request),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await params;
    const { site, ctx } = await requireSiteAccess(request, siteId, "sites:update");
    const gateway = z.enum(GATEWAY_IDS).safeParse(request.nextUrl.searchParams.get("gateway"));
    if (!gateway.success) throw new AppError(400, "INVALID_INPUT", "gateway must be razorpay or stripe");
    await db.delete(sitePaymentGateways).where(and(eq(sitePaymentGateways.siteId, siteId), eq(sitePaymentGateways.gateway, gateway.data)));
    await recordAuditLog({
      workspaceId: site.workspaceId,
      actorId: ctx.userId,
      action: "payment_gateway:remove",
      targetType: "site",
      targetId: site.id,
      metadata: { gateway: gateway.data },
      ipAddress: getClientIp(request),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
