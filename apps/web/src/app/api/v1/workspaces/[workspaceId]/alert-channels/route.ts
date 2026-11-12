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
import { webhookUrlProblem, type WebhookKind } from "@/lib/webhook-url";
import { checkRateLimit } from "@/lib/rate-limit";
import { decryptChannelConfig, encryptChannelConfig } from "@/lib/channel-config";

// A webhook URL is checked when it is saved (right provider, https, public host); safePost() checks again,
// at the network level, every time it is called.
const webhookUrl = (kind: WebhookKind) =>
  z.string().url().superRefine((value, ctx) => {
    const problem = webhookUrlProblem(kind, value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

const CreateChannelSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("slack"),
    name: z.string().min(1).max(80),
    webhookUrl: webhookUrl("slack"),
  }),
  z.object({
    type: z.literal("discord"),
    name: z.string().min(1).max(80),
    webhookUrl: webhookUrl("discord"),
  }),
  z.object({
    type: z.literal("email"),
    name: z.string().min(1).max(80),
    addresses: z.array(z.string().email()).min(1).max(20),
  }),
  z.object({
    type: z.literal("webhook"),
    name: z.string().min(1).max(80),
    url: webhookUrl("webhook"),
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
    await authenticateRequest(req, workspaceId, "analytics:read");

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
    await authenticateRequest(req, workspaceId, "alerts:manage");
    await checkRateLimit(`channel_create:${workspaceId}`, 20, 60 * 60, "Too many notification channels created. Try again later.");

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

// Webhook URLs and signing secrets are encrypted before they are stored (lib/channel-config).
function buildConfig(data: z.infer<typeof CreateChannelSchema>): Record<string, unknown> {
  switch (data.type) {
    case "slack":
    case "discord":
      return encryptChannelConfig({ webhookUrl: data.webhookUrl });
    case "email":
      return { addresses: data.addresses };
    case "webhook":
      return encryptChannelConfig({ url: data.url, ...(data.secret ? { secret: data.secret } : {}) });
  }
}

function sanitizeConfig(type: ChannelType, stored: Record<string, unknown>): Record<string, unknown> {
  const config = decryptChannelConfig(stored);
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
