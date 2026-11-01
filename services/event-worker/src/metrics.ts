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
  help: "Messages between the end of the batch and the partition high watermark",
  labelNames: ["partition"] as const,
  registers: [registry],
});

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
