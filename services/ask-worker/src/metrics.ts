import http from "node:http";
import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const runsTotal = new client.Counter({
  name: "ask_runs_total",
  help: "Ask runs processed by outcome",
  labelNames: ["result"] as const,
  registers: [registry],
});

export const plannerTokens = new client.Counter({
  name: "ask_planner_tokens_total",
  help: "Tokens spent on planner completions",
  registers: [registry],
});

export const droppedBlocks = new client.Counter({
  name: "ask_grounding_dropped_blocks_total",
  help: "Answer blocks removed by the grounding gate",
  registers: [registry],
});

export const runDuration = new client.Histogram({
  name: "ask_run_duration_seconds",
  help: "Time from picking a run to writing its answer",
  buckets: [1, 2, 5, 10, 20, 30, 60],
  registers: [registry],
});

export const lastSuccess = new client.Gauge({
  name: "ask_worker_last_success_timestamp_seconds",
  help: "Unix time of the last successfully processed run",
  registers: [registry],
});

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
