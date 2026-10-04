/**
 * PATCH /api/v1/workspaces/[workspaceId]/alert-channels/[channelId]
 * DELETE /api/v1/workspaces/[workspaceId]/alert-channels/[channelId]
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@trackme/contracts";
import { db, eq, and, alertChannels } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";

const UpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ workspaceId: string; channelId: string }> }
) {
  try {
    const { workspaceId, channelId } = await props.params;
    await authenticateRequest(req, workspaceId, "admin:workspace");

    const body = await req.json().catch(() => ({}));
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(422, "VALIDATION_ERROR", "Invalid update payload");
    }

    const [updated] = await db
      .update(alertChannels)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(alertChannels.id, channelId), eq(alertChannels.workspaceId, workspaceId)))
      .returning();

    if (!updated) {
      throw new AppError(404, "CHANNEL_NOT_FOUND", "Alert channel not found");
    }

    return NextResponse.json({ channel: { id: updated.id, name: updated.name, enabled: updated.enabled } });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ workspaceId: string; channelId: string }> }
) {
  try {
    const { workspaceId, channelId } = await props.params;
    await authenticateRequest(req, workspaceId, "admin:workspace");

    const deleted = await db
      .delete(alertChannels)
      .where(and(eq(alertChannels.id, channelId), eq(alertChannels.workspaceId, workspaceId)))
      .returning({ id: alertChannels.id });

    if (!deleted[0]) {
      throw new AppError(404, "CHANNEL_NOT_FOUND", "Alert channel not found");
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
