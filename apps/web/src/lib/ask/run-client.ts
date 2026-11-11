import type { Answer, AskScope, Step } from "./types";

/**
 * The live Ask client: start a run, then follow it.
 *
 *   POST /api/v1/ask/runs            → 202 { runId } (or a problem document with a human message)
 *   GET  /api/v1/ask/runs/:id/events → SSE: `step`, then one of `answer` / `error`, then `done`
 *
 * The server is the only authority on what a run may read; the scope is sent as the person sees it and clamped there.
 */

export class RunRefusedError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function startRun(
  question: string,
  scope: AskScope,
  page?: string,
  history?: Array<{ question: string; answer: string }>
): Promise<{ runId: string }> {
  const response = await fetch("/api/v1/ask/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, scope: { ...scope, ...(page ? { page } : {}), ...(history?.length ? { history } : {}) } }),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { detail?: string; title?: string } | null;
    // A refusal with no readable message (a validation failure or a crash) must not be shown as the server's words.
    throw new RunRefusedError(problem?.detail ?? "Ask could not start. Try again.", response.status);
  }
  const body = (await response.json()) as { runId?: string };
  if (!body.runId) throw new RunRefusedError("Ask could not start. Try again.", 500);
  return { runId: body.runId };
}

/** Ask the server to stop a run. Best effort: the panel has already stopped listening, this just stops the spending. */
export async function cancelRun(runId: string): Promise<void> {
  await fetch(`/api/v1/ask/runs/${encodeURIComponent(runId)}`, { method: "DELETE" }).catch(() => undefined);
}

export interface RunHandlers {
  onStep(step: Step): void;
  onAnswer(answer: Answer): void;
  /** Terminal failure: the run could not answer. `message` is already fit to show. */
  onError(message: string): void;
}

/** Follow a run to its end. Returns a function that disconnects early. */
export function streamRun(runId: string, handlers: RunHandlers): () => void {
  const source = new EventSource(`/api/v1/ask/runs/${encodeURIComponent(runId)}/events`);
  let terminal = false;

  const close = () => source.close();
  const stop = () => {
    terminal = true;
    close();
  };

  source.addEventListener("step", (e) => {
    try {
      handlers.onStep((JSON.parse((e as MessageEvent).data) as { step: Step }).step);
    } catch {
      // a malformed step is skipped; the answer still arrives
    }
  });
  source.addEventListener("answer", (e) => {
    try {
      handlers.onAnswer((JSON.parse((e as MessageEvent).data) as { answer: Answer }).answer);
    } catch {
      handlers.onError("The answer could not be read. Reload and try again.");
    }
    stop();
  });
  source.addEventListener("error", (e) => {
    // A named `error` event carries our failure; a bare transport error has no data and is left to EventSource to retry.
    const data = (e as MessageEvent).data;
    if (data) {
      try {
        terminal = true;
        handlers.onError((JSON.parse(data) as { message?: string }).message ?? "The run failed.");
      } catch {
        handlers.onError("The run failed.");
      }
      close();
    }
  });
  source.addEventListener("done", () => {
    terminal = true;
    close();
  });
  source.onerror = () => {
    // The server closes the stream after `done`; EventSource treats that as an error but would retry a finished run.
    if (terminal) close();
  };

  return stop;
}
