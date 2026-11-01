import http from "node:http";
import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const jobRuns = new client.Counter({
  name: "scheduled_job_runs_total",
  help: "Scheduled job runs by outcome",
  labelNames: ["task", "result"] as const,
  registers: [registry],
});

/** Alert when time() - this exceeds a few multiples of the job's interval. */
export const jobLastSuccess = new client.Gauge({
  name: "scheduled_job_last_success_timestamp_seconds",
  help: "Unix time of the last successful run of each scheduled job",
  labelNames: ["task"] as const,
  registers: [registry],
});

export const jobDuration = new client.Histogram({
  name: "scheduled_job_duration_seconds",
  help: "Scheduled job duration",
  labelNames: ["task"] as const,
  buckets: [0.5, 1, 5, 15, 60, 180, 600, 1800],
  registers: [registry],
});

export const reconciliationFindings = new client.Gauge({
  name: "reconciliation_findings",
  help: "Findings from the last nightly reconciliation (aggregate drift, duplicate-id days)",
  labelNames: ["kind"] as const,
  registers: [registry],
});

/**
 * Wraps a job so every run is counted, timed, and stamps the heartbeat on success. A job
 * that stops running (or keeps failing) shows up as a stale heartbeat. Failures are
 * rethrown for the caller's existing handling.
 */
export function instrumentJob<T extends unknown[]>(
  task: string,
  run: (...args: T) => Promise<void>
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    const stop = jobDuration.startTimer({ task });
    try {
      await run(...args);
      jobRuns.inc({ task, result: "success" });
      jobLastSuccess.set({ task }, Date.now() / 1000);
    } catch (error) {
      jobRuns.inc({ task, result: "failure" });
      throw error;
    } finally {
      stop();
    }
  };
}

/** Serves /metrics and /health. Port 0 disables it. */
export function startMetricsServer(port: number): http.Server | null {
  if (port === 0) return null;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200).end("ok");
    } else if (req.url === "/metrics") {
      res.writeHead(200, { "Content-Type": registry.contentType }).end(await registry.metrics());
    } else {
      res.writeHead(404).end();
    }
  });
  server.on("error", (error) => console.error("metrics server error:", error));
  server.listen(port);
  return server;
}
