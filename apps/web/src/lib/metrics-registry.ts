import client from "prom-client";
import { setShadowReporter } from "@trackme/analytics";

/**
 * One registry per process. Next.js re-evaluates modules on hot reload and in
 * separate route bundles, and registering the same metric twice throws, so the
 * registry and its metrics live on globalThis.
 */
type Store = {
  registry: client.Registry;
  queryCache: client.Counter<"endpoint" | "result">;
  routeDuration: client.Histogram<"route" | "status">;
  shadowDiffs: client.Counter<"query">;
};

const globalStore = globalThis as unknown as { __trackmeMetrics?: Store };

function create(): Store {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });
  return {
    registry,
    queryCache: new client.Counter({
      name: "query_cache_total",
      help: "Dashboard query cache lookups by endpoint and result",
      labelNames: ["endpoint", "result"] as const,
      registers: [registry],
    }),
    shadowDiffs: new client.Counter({
      name: "analytics_shadow_diff_total",
      help: "ANALYTICS_READ=shadow runs where v2 disagreed with v1 beyond tolerance, or failed",
      labelNames: ["query"] as const,
      registers: [registry],
    }),
    routeDuration: new client.Histogram({
      name: "web_route_duration_seconds",
      help: "Dashboard API route latency",
      labelNames: ["route", "status"] as const,
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    }),
  };
}

export const metrics: Store = (globalStore.__trackmeMetrics ??= create());

// Count shadow-read differences in this registry and keep the default log line.
setShadowReporter((diff) => {
  metrics.shadowDiffs.inc({ query: diff.query });
  console.warn(`[analytics-shadow] ${diff.query} differs: ${diff.differences.slice(0, 5).join("; ")}`);
});

export type CacheResult = "hit" | "stale" | "miss" | "coalesced" | "error" | "early";

/** `q:v1:{endpoint}:{siteId}:{digest}` -> endpoint, so labels stay bounded. */
export function endpointOf(key: string): string {
  return key.split(":")[2] ?? "unknown";
}

export function recordCache(key: string, result: CacheResult): void {
  metrics.queryCache.inc({ endpoint: endpointOf(key), result });
}

/** Wrap a route handler to record its latency by route name and status class. */
export function timedRoute<A extends unknown[]>(
  route: string,
  handler: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const stop = metrics.routeDuration.startTimer();
    let status = "5xx";
    try {
      const response = await handler(...args);
      status = `${Math.floor(response.status / 100)}xx`;
      return response;
    } finally {
      stop({ route, status });
    }
  };
}
