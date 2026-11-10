/**
 * Phase 0 probe: snapshot the system before and after a load run and report the numbers
 * docs/architecture/INGESTION_SCALE_ARCHITECTURE.md marks [est]. Counters are diffed, so nothing here
 * needs resetting and nothing needs a Prometheus server.
 *
 *   Redis       commands and EVAL calls per request, key growth per event (F1, F2)
 *   ClickHouse  blocks (= new parts) per second, rows per block, parts per partition (F6)
 *   Metrics     p50/p99 per edge stage and worker stage, end-to-end latency (F3, F8)
 *   Views       time and rows written per materialized view (MV fan-out audit)
 */
import { Redis } from "ioredis";
import { env } from "@trackme/config";
import { getClickHouseClient } from "@trackme/analytics";

type Buckets = Map<number, number>; // le -> cumulative count
type Snapshot = {
  at: number;
  prom: string[];
  redis: { url: string; cmds: Record<string, number>; stats: number; keys: number; mem: number }[];
  ch: Record<string, number>;
};

const CH_EVENTS = ["InsertQuery", "InsertedRows", "MergeTreeDataWriterBlocks", "MergeTreeDataWriterRows", "DelayedInserts", "RejectedInserts"];

/** Sum of every series of a gauge or counter. */
export const gauge = (text: string, name: string) =>
  [...text.matchAll(new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+(\\S+)$`, "gm"))].reduce((s, m) => s + Number(m[1]), 0);

/** label set (without `le`) -> cumulative buckets, for one Prometheus histogram. */
export function histograms(text: string, name: string): Map<string, Buckets> {
  const out = new Map<string, Buckets>();
  for (const m of text.matchAll(new RegExp(`^${name}_bucket\\{([^}]*)\\}\\s+(\\S+)$`, "gm"))) {
    const le = /le="([^"]+)"/.exec(m[1]!)![1]!;
    const key = m[1]!.replace(/,?le="[^"]+"/, "").replace(/^,/, "");
    if (!out.has(key)) out.set(key, new Map());
    out.get(key)!.set(le === "+Inf" ? Infinity : Number(le), Number(m[2]));
  }
  return out;
}

/** histogram_quantile over the difference of two scrapes; values are in the metric's unit. */
export function quantiles(before: Map<string, Buckets>, after: Map<string, Buckets>, qs: number[]) {
  const out: Record<string, Record<string, number>> = {};
  for (const [key, a] of after) {
    const b = before.get(key);
    const les = [...a.keys()].sort((x, y) => x - y);
    const cum = les.map((le) => a.get(le)! - (b?.get(le) ?? 0));
    const n = cum[cum.length - 1] ?? 0;
    if (n <= 0) continue;
    const row: Record<string, number> = { n };
    for (const q of qs) {
      const target = q * n;
      const i = cum.findIndex((c) => c >= target);
      const hi = les[i]!;
      const lo = i > 0 ? les[i - 1]! : 0;
      const c0 = i > 0 ? cum[i - 1]! : 0;
      row[`p${q * 100}`] = hi === Infinity ? lo : lo + ((hi - lo) * (target - c0)) / Math.max(1, cum[i]! - c0);
    }
    out[key || "all"] = row;
  }
  return out;
}

async function redisSnapshot(url: string) {
  const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await r.connect();
  try {
    const [cs, st, mem, keys] = await Promise.all([r.info("commandstats"), r.info("stats"), r.info("memory"), r.dbsize()]);
    const cmds: Record<string, number> = {};
    for (const m of cs.matchAll(/cmdstat_(\w+):calls=(\d+)/g)) cmds[m[1]!] = Number(m[2]);
    return {
      url,
      cmds,
      stats: Number(/total_commands_processed:(\d+)/.exec(st)?.[1] ?? 0),
      mem: Number(/used_memory:(\d+)/.exec(mem)?.[1] ?? 0),
      keys,
    };
  } finally {
    r.disconnect();
  }
}

export async function snapshot(metricUrls: string[]): Promise<Snapshot> {
  const urls = [...new Set([env.REDIS_URL, env.REDIS_STATE_URL])];
  const ch = getClickHouseClient();
  const [prom, redis, events] = await Promise.all([
    Promise.all(metricUrls.map((u) => fetch(u).then((r) => r.text()))),
    Promise.all(urls.map(redisSnapshot)),
    ch
      .query({
        query: `SELECT event, value FROM system.events WHERE event IN (${CH_EVENTS.map((e) => `'${e}'`).join(",")})`,
        format: "JSONEachRow",
      })
      .then((r) => r.json<{ event: string; value: string }>()),
  ]);
  return { at: Date.now(), prom, redis, ch: Object.fromEntries(events.map((e) => [e.event, Number(e.value)])) };
}

/** Largest active-part count in any one partition, per table (the "too many parts" gauge). */
export async function partsMax(): Promise<Record<string, number>> {
  const r = await getClickHouseClient().query({
    query: `SELECT table, max(c) AS parts FROM (SELECT table, partition, count() AS c FROM system.parts
            WHERE active AND database = currentDatabase() GROUP BY table, partition) GROUP BY table`,
    format: "JSONEachRow",
  });
  return Object.fromEntries((await r.json<{ table: string; parts: string }>()).map((x) => [x.table, Number(x.parts)]));
}

/** Rows written and time spent per materialized view since `sinceMs`. Empty if the log is not enabled. */
export async function viewCost(sinceMs: number) {
  const ch = getClickHouseClient();
  try {
    await ch.command({ query: "SYSTEM FLUSH LOGS" });
    const r = await ch.query({
      query: `SELECT view_name AS view, count() AS inserts, sum(written_rows) AS rows, round(sum(view_duration_ms)) AS ms
              FROM system.query_views_log WHERE event_time >= toDateTime({since:UInt32}) GROUP BY view ORDER BY ms DESC`,
      query_params: { since: Math.floor(sinceMs / 1000) },
      format: "JSONEachRow",
    });
    return await r.json<{ view: string; inserts: string; rows: string; ms: string }>();
  } catch {
    return [];
  }
}

const sumCalls = (c: Record<string, number>) => (c.eval ?? 0) + (c.evalsha ?? 0);

/** Everything derivable from two snapshots. `requests` and `events` are the load generator's own counts. */
export function compare(b: Snapshot, a: Snapshot, requests: number, events: number) {
  const secs = (a.at - b.at) / 1000;
  const [bEdge, bWorker] = b.prom;
  const [aEdge, aWorker] = a.prom;
  const stage = (bt: string, at: string, name: string) => quantiles(histograms(bt!, name), histograms(at!, name), [0.5, 0.99]);
  const rd = a.redis.map((x, i) => {
    const y = b.redis[i]!;
    return {
      redis: x.url.replace(/\/\/.*@/, "//"),
      commandsPerRequest: +((x.stats - y.stats) / Math.max(1, requests)).toFixed(2),
      scriptCallsPerRequest: +((sumCalls(x.cmds) - sumCalls(y.cmds)) / Math.max(1, requests)).toFixed(2),
      keysPerEvent: +((x.keys - y.keys) / Math.max(1, events)).toFixed(3),
      memoryDeltaMB: +((x.mem - y.mem) / 1e6).toFixed(1),
    };
  });
  const d = (k: string) => (a.ch[k] ?? 0) - (b.ch[k] ?? 0);
  return {
    seconds: +secs.toFixed(1),
    redis: rd,
    clickhouse: {
      insertsPerSec: +(d("InsertQuery") / secs).toFixed(1),
      newPartsPerSec: +(d("MergeTreeDataWriterBlocks") / secs).toFixed(1),
      rowsPerPart: Math.round(d("MergeTreeDataWriterRows") / Math.max(1, d("MergeTreeDataWriterBlocks"))),
      delayedInserts: d("DelayedInserts"),
      rejectedInserts: d("RejectedInserts"),
    },
    edgeStageSeconds: stage(bEdge!, aEdge!, "edge_stage_duration_seconds"),
    workerStageSeconds: stage(bWorker!, aWorker!, "worker_stage_seconds"),
    e2eSeconds: stage(bWorker!, aWorker!, "worker_e2e_latency_seconds").all,
  };
}
