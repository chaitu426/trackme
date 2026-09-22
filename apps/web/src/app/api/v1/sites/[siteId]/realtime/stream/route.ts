import { NextRequest } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, eq, sites } from "@trackme/db";
import { requireMetricsAccess } from "@/lib/tenancy";
import { subscribeSiteRealtime } from "@/lib/realtime-hub";
import { jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE stream of realtime visitor snapshots.
 * Uses a process-shared hub (Redis pub/sub + 5s fallback) so N dashboards
 * for the same site share one Redis read path.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await context.params;

    const siteRows = await db
      .select({ id: sites.id, workspaceId: sites.workspaceId })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1);
    const site = siteRows[0];
    if (!site) {
      throw new AppError(404, "NOT_FOUND", "Site not found");
    }

    await requireMetricsAccess(request, site.workspaceId, site.id);

    const encoder = new TextEncoder();
    let closed = false;
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const cleanup = () => {
          if (closed) return;
          closed = true;
          unsubscribe?.();
          unsubscribe = null;
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = null;
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        unsubscribe = subscribeSiteRealtime(siteId, (snapshot) => {
          if (closed) return;
          try {
            const payload = `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
            controller.enqueue(encoder.encode(payload));
          } catch {
            cleanup();
          }
        });

        heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } catch {
            cleanup();
          }
        }, 15_000);

        request.signal.addEventListener("abort", cleanup);
      },
      cancel() {
        closed = true;
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
