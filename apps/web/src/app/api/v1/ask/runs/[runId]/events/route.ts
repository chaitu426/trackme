import { NextRequest } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, askRuns, eq } from "@trackme/db";
import { parseReadReply, streamKey, type RunEvent } from "@trackme/ask";
import type { Answer } from "@trackme/ask";
import { requireMetricsAccess } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BLOCK_MS = 15_000;
const HEARTBEAT_MS = 20_000;
const STREAM_DONE = "done";

/**
 * SSE stream of one Ask run: `step` events as the worker reads, then `answer` or `error`, then a terminal `done`.
 *
 * The stream is replayed first, so a client that connects late (or reconnects) still sees every step. When the run's stream
 * has nothing left and the row says done or failed, the row's answer is authoritative: the stream is approximate (MAXLEN) and
 * Redis may have trimmed it, and the row is what the worker committed.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const rows = await db.select().from(askRuns).where(eq(askRuns.id, runId)).limit(1);
    const run = rows[0];
    if (!run || !run.siteId) throw new AppError(404, "NOT_FOUND", "Run not found");
    await requireMetricsAccess(request, run.workspaceId, run.siteId, "ask");

    // Each SSE connection gets its own blocking reader; sharing the web process's command client would park it.
    const reader = getRedis("state").duplicate();
    const encoder = new TextEncoder();
    let closed = false;

    const state = async () =>
      (
        await db
          .select({ status: askRuns.status, answer: askRuns.answer, error: askRuns.error })
          .from(askRuns)
          .where(eq(askRuns.id, runId))
          .limit(1)
      )[0] ?? null;

    const stream = new ReadableStream({
      async start(controller) {
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let lastId = "0";

        const stopTimer = () => {
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = null;
        };
        const abort = () => {
          if (closed) return;
          closed = true;
          stopTimer();
          reader.disconnect();
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        const finish = async (message: string) => {
          if (closed) return;
          closed = true;
          stopTimer();
          try {
            controller.enqueue(encoder.encode(`event: ${STREAM_DONE}\ndata: ${JSON.stringify({ message })}\n\n`));
            controller.close();
          } catch {
            // already closed
          }
          await reader.quit().catch(() => reader.disconnect());
        };
        // Returns true when the event was terminal (answer or error): the caller then finishes the stream.
        const emit = (event: RunEvent): boolean => {
          if (closed) return false;
          try {
            controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
          } catch {
            abort();
          }
          return event.type === "answer" || event.type === "error";
        };
        const emitFromRow = (s: NonNullable<Awaited<ReturnType<typeof state>>>): boolean | "failed" => {
          if (s.status === "done" && s.answer) return emit({ type: "answer", answer: s.answer as Answer });
          if (s.status === "failed") return emit({ type: "error", message: s.error ?? "The run failed." }) || "failed";
          if (s.status === "cancelled") return emit({ type: "error", message: "Stopped." }) || "failed";
          return false;
        };

        request.signal.addEventListener("abort", abort);
        try {
          // 1. Replay everything already published; a run that finished while we were away ends here.
          const entries = await reader.xrange(streamKey(runId), "-", "+");
          const replayed = parseReadReply([[streamKey(runId), entries]]);
          for (const { id, event } of replayed) {
            lastId = id;
            if (emit(event)) {
              await finish(event.type === "answer" ? "done" : "failed");
              return;
            }
          }

          // 2. A run that already finished, whose answer the stream did not carry (trimmed, or a publish race).
          const initial = await state();
          if (initial && (initial.status === "done" || initial.status === "failed" || initial.status === "cancelled")) {
            if (emitFromRow(initial)) {
              await finish(initial.status);
              return;
            }
          }

          heartbeat = setInterval(() => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`: ping\n\n`));
            } catch {
              abort();
            }
          }, HEARTBEAT_MS);

          // 3. Follow live until a terminal event, or until the row says the run is over.
          while (!closed) {
            const live = parseReadReply(await reader.xread("BLOCK", BLOCK_MS, "STREAMS", streamKey(runId), lastId));
            for (const { id, event } of live) {
              lastId = id;
              if (emit(event)) {
                await finish(event.type === "answer" ? "done" : "failed");
                return;
              }
            }
            if (live.length === 0) {
              const ended = await state();
              if (ended && (ended.status === "done" || ended.status === "failed" || ended.status === "cancelled")) {
                // No step arrived for a full block and the row is final: nothing more will come.
                emitFromRow(ended);
                await finish(ended.status);
                return;
              }
            }
          }
        } catch (err) {
          if (!closed) {
            emit({ type: "error", message: "The live stream was interrupted." });
            await finish("failed");
          }
          console.warn(`[ask] SSE for run ${runId} ended:`, (err as Error)?.message ?? err);
        }
      },
      cancel() {
        closed = true;
        reader.disconnect();
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
