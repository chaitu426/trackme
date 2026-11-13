import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, sites, eq, and } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { explainFor } from "@/lib/access";

const Query = z.object({ userId: z.string().uuid(), siteId: z.string().uuid() });

/**
 * GET /api/v1/workspaces/:id/access/effective?userId=&siteId=
 *
 * What a person can do on a site and why: from their role, from which teams, or from a personal grant. For the admin's
 * "view as" panel, so access is never a mystery.
 */
export async function GET(request: NextRequest, props: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await props.params;
    await authenticateRequest(request, workspaceId, "workspace:members");
    const parsed = Query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new AppError(400, "INVALID_INPUT", "userId and siteId are required.");

    const [site] = await db.select({ id: sites.id }).from(sites).where(and(eq(sites.id, parsed.data.siteId), eq(sites.workspaceId, workspaceId))).limit(1);
    if (!site) throw new AppError(404, "SITE_NOT_FOUND", "Site not found in this workspace.");

    return NextResponse.json(await explainFor(workspaceId, parsed.data.userId, parsed.data.siteId));
  } catch (error) {
    return jsonError(error);
  }
}
