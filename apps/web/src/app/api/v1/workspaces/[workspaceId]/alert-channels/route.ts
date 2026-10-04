/**
 * GET /api/v1/workspaces/[workspaceId]/alert-channels
 * POST /api/v1/workspaces/[workspaceId]/alert-channels
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@trackme/contracts";
import { db, eq, alertChannels } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";

const CreateChannelSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("slack"),
    name: z.string().min(1).max(80),
    webhookUrl: z.string().url(),
  }),
  z.object({
    type: z.literal("discord"),
    name: z.string().min(1).max(80),
    webhookUrl: z.string().url(),
  }),
  z.object({
    type: z.literal("email"),
    name: z.string().min(1).max(80),
    addresses: z.array(z.string().email()).min(1).max(20),
  }),
  z.object({
    type: z.literal("webhook"),
    name: z.string().min(1).max(80),
    url: z.string().url(),
    secret: z.string().min(8).optional(),
  }),
]);

type ChannelType = "slack" | "discord" | "email" | "webhook";

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await props.params;
    await authenticateRequest(req, workspaceId, "read:analytics");

    const channels = await db
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.workspaceId, workspaceId))
      .orderBy(alertChannels.createdAt);

    const safe = channels.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      enabled: c.enabled,
      lastTestedAt: c.lastTestedAt,
      createdAt: c.createdAt,
      config: sanitizeConfig(c.type as ChannelType, c.config as Record<string, unknown>),
    }));

    return NextResponse.json({ channels: safe });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await props.params;
    await authenticateRequest(req, workspaceId, "admin:workspace");

    const body = await req.json().catch(() => ({}));
    const parsed = CreateChannelSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(422, "VALIDATION_ERROR", "Invalid channel definition");
    }

    const data = parsed.data;
    const config = buildConfig(data);

    const [channel] = await db
      .insert(alertChannels)
      .values({
        workspaceId,
        name: data.name,
        type: data.type,
        config,
        enabled: true,
      })
      .returning();

    return NextResponse.json(
      { channel: { ...channel, config: sanitizeConfig(data.type, config) } },
      { status: 201 }
    );
  } catch (err) {
    return jsonError(err);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildConfig(data: z.infer<typeof CreateChannelSchema>): Record<string, unknown> {
  switch (data.type) {
    case "slack":
    case "discord":
      return { webhookUrl: data.webhookUrl };
    case "email":
      return { addresses: data.addresses };
    case "webhook":
      return { url: data.url, ...(data.secret ? { secret: data.secret } : {}) };
  }
}

function sanitizeConfig(type: ChannelType, config: Record<string, unknown>): Record<string, unknown> {
  switch (type) {
    case "slack":
    case "discord": {
      const url = config.webhookUrl as string | undefined;
      return { webhookUrlPreview: url ? maskUrl(url) : null };
    }
    case "email":
      return { addresses: config.addresses };
    case "webhook": {
      const url = config.url as string | undefined;
      return { urlPreview: url ? maskUrl(url) : null, hasSigning: !!config.secret };
    }
    default:
      return {};
  }
}

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}/***`;
  } catch {
    return "***";
  }
}
