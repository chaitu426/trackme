/**
 * POST /api/v1/workspaces/[workspaceId]/alert-channels/[channelId]/test
 *
 * Fires a live test notification to verify the channel works.
 */

import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, eq, and, alertChannels, workspaces } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { dispatchAlert } from "@/lib/alerts";
import { env } from "@trackme/config";

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ workspaceId: string; channelId: string }> }
) {
  try {
    const { workspaceId, channelId } = await props.params;
    await authenticateRequest(req, workspaceId, "alerts:manage");
    // A test sends a real outbound request, so it is limited like any other way of making this server call out.
    await checkRateLimit(`channel_test:${workspaceId}`, 10, 60, "Too many test notifications. Wait a minute and try again.");

    // Load channel and workspace in parallel
    const [channelRows, workspaceRows] = await Promise.all([
      db
        .select()
        .from(alertChannels)
        .where(and(eq(alertChannels.id, channelId), eq(alertChannels.workspaceId, workspaceId)))
        .limit(1),
      db
        .select({ name: workspaces.name, slug: workspaces.slug })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1),
    ]);

    const channel = channelRows[0];
    const workspace = workspaceRows[0];

    if (!channel) {
      throw new AppError(404, "CHANNEL_NOT_FOUND", "Alert channel not found");
    }

    const result = await dispatchAlert(
      {
        type: channel.type as "slack" | "discord" | "email" | "webhook",
        config: channel.config as Record<string, unknown>,
      },
      {
        title: "✅ Test Notification",
        message:
          "This is a test alert from TrackMe. Your notification channel is configured correctly and working as expected!",
        timestamp: new Date().toISOString(),
        siteDomain: "test.example.com",
        workspaceName: workspace?.name ?? "Your Workspace",
        ruleType: "test",
        fields: {
          "Channel Name": channel.name,
          "Channel Type": channel.type,
          Status: "Connected ✓",
        },
        dashboardUrl: `${env.APP_URL}/${workspace?.slug ?? ""}`,
      }
    );

    if (result.ok) {
      await db
        .update(alertChannels)
        .set({ lastTestedAt: new Date(), updatedAt: new Date() })
        .where(eq(alertChannels.id, channelId));
    }

    return NextResponse.json({ ok: result.ok, error: result.error ?? null });
  } catch (err) {
    return jsonError(err);
  }
}
