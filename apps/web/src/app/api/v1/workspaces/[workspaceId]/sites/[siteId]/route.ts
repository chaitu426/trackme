import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, sites, eq, and } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";

const UpdateSiteSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
});

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ workspaceId: string; siteId: string }> }
) {
  try {
    const { workspaceId, siteId } = await props.params;
    await authenticateRequest(request, workspaceId, "admin:workspace");

    // Ensure at least 1 site remains in workspace
    const allSites = await db
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.workspaceId, workspaceId));

    if (allSites.length <= 1) {
      throw new AppError(400, "CANNOT_DELETE_LAST_SITE", "An organization must keep at least one site.");
    }

    const deleted = await db
      .delete(sites)
      .where(and(eq(sites.id, siteId), eq(sites.workspaceId, workspaceId)))
      .returning({ id: sites.id });

    if (!deleted[0]) {
      throw new AppError(404, "SITE_NOT_FOUND", "Site not found in this workspace.");
    }

    return NextResponse.json({ success: true, deletedId: siteId });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ workspaceId: string; siteId: string }> }
) {
  try {
    const { workspaceId, siteId } = await props.params;
    await authenticateRequest(request, workspaceId, "admin:workspace");

    const body = await request.json().catch(() => ({}));
    const parsed = UpdateSiteSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "Invalid site update data.");
    }

    const updated = await db
      .update(sites)
      .set({
        displayName: parsed.data.displayName,
      })
      .where(and(eq(sites.id, siteId), eq(sites.workspaceId, workspaceId)))
      .returning();

    if (!updated[0]) {
      throw new AppError(404, "SITE_NOT_FOUND", "Site not found in this workspace.");
    }

    return NextResponse.json({ site: updated[0] });
  } catch (error) {
    return jsonError(error);
  }
}
