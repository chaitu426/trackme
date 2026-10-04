import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, siteFunnels, sites, eq, desc } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";

const FunnelStepSchema = z.object({
  order: z.number().int().min(1),
  name: z.string().trim().min(1).max(100),
  type: z.enum(["pageview", "custom_event"]),
  target: z.string().trim().min(1).max(256),
});

const CreateFunnelSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(256).optional(),
  steps: z.array(FunnelStepSchema).min(2, "A funnel must have at least 2 steps"),
});

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await props.params;

    const [siteRow] = await db
      .select({ id: sites.id, workspaceId: sites.workspaceId })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1);

    if (!siteRow) {
      throw new AppError(404, "SITE_NOT_FOUND", "Site not found.");
    }

    await authenticateRequest(request, siteRow.workspaceId, "read:analytics");

    const funnels = await db
      .select()
      .from(siteFunnels)
      .where(eq(siteFunnels.siteId, siteId))
      .orderBy(desc(siteFunnels.createdAt));

    return NextResponse.json({ funnels });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await props.params;

    const [siteRow] = await db
      .select({ id: sites.id, workspaceId: sites.workspaceId })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1);

    if (!siteRow) {
      throw new AppError(404, "SITE_NOT_FOUND", "Site not found.");
    }

    await authenticateRequest(request, siteRow.workspaceId, "sites:update");

    const body = await request.json().catch(() => ({}));
    const parsed = CreateFunnelSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", parsed.error.issues[0]?.message || "Invalid funnel definition.");
    }

    const { name, description, steps } = parsed.data;

    // Ensure steps are ordered 1..N
    const sortedSteps = [...steps].sort((a, b) => a.order - b.order).map((s, idx) => ({
      ...s,
      order: idx + 1,
    }));

    const [created] = await db
      .insert(siteFunnels)
      .values({
        siteId,
        name,
        description: description || null,
        steps: sortedSteps,
      })
      .returning();

    return NextResponse.json({ funnel: created }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
