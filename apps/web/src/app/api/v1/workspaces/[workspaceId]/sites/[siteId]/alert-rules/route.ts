/**
 * GET /api/v1/workspaces/[workspaceId]/sites/[siteId]/alert-rules
 * POST /api/v1/workspaces/[workspaceId]/sites/[siteId]/alert-rules
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@trackme/contracts";
import { db, eq, and, alertRules, alertChannels } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const TrafficThresholdConfig = z.object({
  thresholdPercent: z.number().min(10).max(1000),
  windowHours: z.number().min(1).max(168).default(24),
});

const GoalMilestoneConfig = z.object({
  goalId: z.string().uuid(),
  milestoneCount: z.number().min(1),
});

const WeeklyDigestConfig = z.object({
  timezone: z.string().default("UTC"),
});

const CreateRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("traffic_spike"),
    name: z.string().min(1).max(120),
    channelId: z.string().uuid(),
    cooldownMinutes: z.number().min(15).max(1440).default(60),
    config: TrafficThresholdConfig,
  }),
  z.object({
    type: z.literal("traffic_drop"),
    name: z.string().min(1).max(120),
    channelId: z.string().uuid(),
    cooldownMinutes: z.number().min(15).max(1440).default(60),
    config: TrafficThresholdConfig,
  }),
  z.object({
    type: z.literal("goal_milestone"),
    name: z.string().min(1).max(120),
    channelId: z.string().uuid(),
    cooldownMinutes: z.number().min(0).max(43200).default(0),
    config: GoalMilestoneConfig,
  }),
  z.object({
    type: z.literal("weekly_digest"),
    name: z.string().min(1).max(120),
    channelId: z.string().uuid(),
    cooldownMinutes: z.number().default(0),
    config: WeeklyDigestConfig,
  }),
]);

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ workspaceId: string; siteId: string }> }
) {
  try {
    const { workspaceId, siteId } = await props.params;
    await authenticateRequest(req, workspaceId, "read:analytics");

    const rules = await db
      .select({
        id: alertRules.id,
        siteId: alertRules.siteId,
        channelId: alertRules.channelId,
        type: alertRules.type,
        name: alertRules.name,
        config: alertRules.config,
        enabled: alertRules.enabled,
        cooldownMinutes: alertRules.cooldownMinutes,
        lastFiredAt: alertRules.lastFiredAt,
        createdAt: alertRules.createdAt,
        channelName: alertChannels.name,
        channelType: alertChannels.type,
      })
      .from(alertRules)
      .leftJoin(alertChannels, eq(alertRules.channelId, alertChannels.id))
      .where(eq(alertRules.siteId, siteId));

    return NextResponse.json({ rules });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ workspaceId: string; siteId: string }> }
) {
  try {
    const { workspaceId, siteId } = await props.params;
    await authenticateRequest(req, workspaceId, "admin:workspace");

    const body = await req.json();
    const parsed = CreateRuleSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(422, "VALIDATION_ERROR", "Invalid rule definition");
    }

    const data = parsed.data;

    // Verify the channel belongs to this workspace
    const [channel] = await db
      .select()
      .from(alertChannels)
      .where(and(eq(alertChannels.id, data.channelId), eq(alertChannels.workspaceId, workspaceId)))
      .limit(1);

    if (!channel) {
      throw new AppError(404, "CHANNEL_NOT_FOUND", "Alert channel not found in this workspace");
    }

    const [rule] = await db
      .insert(alertRules)
      .values({
        siteId,
        channelId: data.channelId,
        type: data.type,
        name: data.name,
        config: data.config,
        enabled: true,
        cooldownMinutes: data.cooldownMinutes,
      })
      .returning();

    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
