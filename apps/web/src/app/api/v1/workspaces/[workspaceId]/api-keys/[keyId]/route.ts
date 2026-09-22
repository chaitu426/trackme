import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, apiKeys, eq, and } from "@trackme/db";
import { requireWorkspaceMember } from "@/lib/tenancy";
import { recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/http";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; keyId: string }> }
) {
  try {
    const { workspaceId, keyId } = await params;
    const ctx = await requireWorkspaceMember(request, workspaceId, "api_keys:manage");

    const existingRows = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.workspaceId, workspaceId)))
      .limit(1);

    const existing = existingRows[0];
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "API key not found in this workspace");
    }

    await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.workspaceId, workspaceId)));

    await recordAuditLog({
      workspaceId,
      actorId: ctx.userId,
      action: "api_key:revoke",
      targetType: "api_key",
      targetId: keyId,
      metadata: { name: existing.name, prefix: existing.prefix },
      ipAddress: request.headers.get("x-forwarded-for") || null,
    });

    return NextResponse.json({ success: true, revokedId: keyId });
  } catch (error) {
    return jsonError(error);
  }
}
