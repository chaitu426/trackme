import http from "node:http";
import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export type DeadLetterReason = "malformed" | "contract" | "clickhouse_rejected";

export const batchRows = new client.Histogram({
  name: "worker_batch_rows",
  help: "Kafka messages per consumed batch",
  buckets: [1, 10, 100, 1_000, 5_000, 10_000, 50_000, 100_000],
  registers: [registry],
});

export const insertDuration = new client.Histogram({
  name: "worker_insert_duration_seconds",
  help: "Time to insert one batch into ClickHouse, including row isolation",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const eventsStored = new client.Counter({
  name: "worker_events_stored_total",
  help: "Events written to ClickHouse",
  registers: [registry],
});

export const deadLettered = new client.Counter({
  name: "worker_dlq_total",
  help: "Messages sent to the dead-letter topic",
  labelNames: ["reason"] as const,
  registers: [registry],
});

export const v2WriteErrors = new client.Counter({
  name: "worker_v2_write_errors_total",
  help: "Failed shadow writes to events_ingest (legacy write succeeded)",
  registers: [registry],
});

export const realtimeErrors = new client.Counter({
  name: "worker_realtime_errors_total",
  help: "Failed realtime Redis updates (non-fatal)",
  registers: [registry],
});

export const consumerLag = new client.Gauge({
  name: "worker_consumer_lag",
  help: "Messages between the committed offset and the partition high watermark",
  labelNames: ["partition"] as const,
  registers: [registry],
});

/**
 * Lag summed across partitions. Sampled on a timer by the admin client, so it
 * stays truthful while the consumer is stalled (the per-batch gauge cannot).
 */
export const consumerLagTotal = new client.Gauge({
  name: "worker_consumer_lag_total",
  help: "Messages between the committed offsets and the high watermarks across all partitions",
  registers: [registry],
});

/** Edge receipt -> ClickHouse insert completion. */
export const e2eLatency = new client.Histogram({
  name: "worker_e2e_latency_seconds",
  help: "Time from the edge receipt timestamp to a successful ClickHouse insert",
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  registers: [registry],
});

export const intentErrors = new client.Counter({
  name: "worker_intent_errors_total",
  help: "Failed reads or writes of the replay-intent record; exact replay is not guaranteed while this grows",
  registers: [registry],
});

export const stageSeconds = new client.Histogram({
  name: "worker_stage_seconds",
  help: "Wall time per writer batch phase: decode, insert, dlq",
  labelNames: ["stage"] as const,
  buckets: [0.001, 0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/** Returns lap(stage): observes the time since the previous lap (or creation) under `stage`. */
export function stopwatch(): (stage: string) => void {
  let last = performance.now();
  return (stage) => {
    const now = performance.now();
    stageSeconds.observe({ stage }, (now - last) / 1000);
    last = now;
  };
}

/** Messages still to read after this batch; never negative. */
export function lagAfter(highWatermark: string, lastOffset: string): number {
  const lag = Number(BigInt(highWatermark) - BigInt(lastOffset) - 1n);
  return lag < 0 ? 0 : lag;
}

/** Serve /metrics on an internal port. A port of 0 disables the server. */
export function startMetricsServer(port: number): http.Server | null {
  if (port <= 0) return null;
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/metrics") {
      res.writeHead(200, { "Content-Type": registry.contentType });
      res.end(await registry.metrics());
      return;
    }
    res.writeHead(req.url === "/health" ? 200 : 404).end();
  });
  server.listen(port);
  server.unref();
  return server;
}
