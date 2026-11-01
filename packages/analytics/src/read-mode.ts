import type { ClickHouseClient } from "@clickhouse/client";
import { env } from "@trackme/config";
import { getDashboardClickHouseClient } from "./client.js";

/** Which schema a query reads: legacy tables (v1) or events_v2 plus the aggregates (v2). */
export type ReadVariant = "v1" | "v2";
export type ReadMode = ReadVariant | "shadow";

export function currentReadMode(): ReadMode {
  return env.ANALYTICS_READ;
}

/**
 * Rewrites a legacy event-level query to read events_v2. Session and visitor ids are
 * stored as cityHash64 hashes there, and a referrer filter compares the domain (the
 * breakdowns list domains, so a clicked value must filter on the same thing).
 *
 * Only for queries over raw events. Aggregate-table queries are written separately.
 */
export function toV2Sql(sql: string): string {
  return sql
    .replace(/visitor_pseudonym\s*=\s*\{identifier:String\}/g, "visitor_hash = cityHash64({identifier:String})")
    .replace(/\breferrer\s*=\s*\{filter_referrer/g, "referrer_domain = {filter_referrer")
    .replace(/\bevents_raw\b/g, "events_v2")
    .replace(/\bvisitor_pseudonym\b/g, "visitor_hash")
    .replace(/\bsession_id\b/g, "session_hash");
}

export type ReadClient = Pick<ClickHouseClient, "query">;

/** The dashboard client for a variant. For v2 it applies toV2Sql to every query. */
export function readClient(variant: ReadVariant): ReadClient {
  const client = getDashboardClickHouseClient();
  if (variant === "v1") return client;
  return {
    query: ((params: Parameters<ClickHouseClient["query"]>[0]) =>
      client.query({ ...params, query: toV2Sql(params.query) })) as ClickHouseClient["query"],
  };
}

export interface ShadowDiff {
  query: string;
  differences: string[];
  v1: unknown;
  v2: unknown;
}

type Reporter = (diff: ShadowDiff) => void;
let reporter: Reporter = (diff) => {
  console.warn(`[analytics-shadow] ${diff.query} differs: ${diff.differences.slice(0, 5).join("; ")}`);
};

/** Lets the host app count differences (for example in its Prometheus registry). */
export function setShadowReporter(next: Reporter): void {
  reporter = next;
}

const DEFAULT_TOLERANCE = 0.02;

/**
 * Walks two results and lists where they disagree. Numbers differ when the relative
 * gap exceeds `tolerance` (with a small absolute allowance so tiny counts do not flap);
 * everything else must be equal. Arrays are compared by index, so callers whose order
 * is not stable (ties) should compare the sorted form.
 */
export function diffResults(a: unknown, b: unknown, tolerance = DEFAULT_TOLERANCE, path = "$"): string[] {
  if (typeof a === "number" && typeof b === "number") {
    const gap = Math.abs(a - b);
    return gap <= 2 || gap / Math.max(Math.abs(a), Math.abs(b), 1) <= tolerance ? [] : [`${path}: ${a} vs ${b}`];
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: string[] = [];
    if (a.length !== b.length) out.push(`${path}.length: ${a.length} vs ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) out.push(...diffResults(a[i], b[i], tolerance, `${path}[${i}]`));
    return out;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) =>
      diffResults((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tolerance, `${path}.${k}`)
    );
  }
  return a === b ? [] : [`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`];
}

export interface DispatchOptions<T> {
  /** Maps a result to the comparable part (drop ordering noise, fields v2 changes on purpose). */
  normalize?: (result: T) => unknown;
  tolerance?: number;
}

/**
 * Runs a query under ANALYTICS_READ. `v1` and `v2` run one variant. `shadow` runs
 * both, returns v1, and reports differences; a failing v2 never affects the answer.
 */
export async function dispatch<T>(
  name: string,
  run: (variant: ReadVariant) => Promise<T>,
  options: DispatchOptions<T> = {},
  mode: ReadMode = currentReadMode()
): Promise<T> {
  if (mode !== "shadow") return run(mode);

  const [v1, v2] = await Promise.allSettled([run("v1"), run("v2")]);
  if (v1.status === "rejected") throw v1.reason;
  if (v2.status === "rejected") {
    reporter({ query: name, differences: [`v2 failed: ${String(v2.reason)}`], v1: v1.value, v2: null });
    return v1.value;
  }
  const normalize = options.normalize ?? ((r: T) => r);
  const differences = diffResults(normalize(v1.value), normalize(v2.value), options.tolerance);
  if (differences.length > 0) reporter({ query: name, differences, v1: v1.value, v2: v2.value });
  return v1.value;
}

/**
 * Wraps a query implementation that takes the read variant as its last argument into
 * the public function (without it) that honors ANALYTICS_READ.
 */
export function variantAware<A extends unknown[], R>(
  name: string,
  impl: (...args: [...A, ReadVariant]) => Promise<R>,
  options?: DispatchOptions<R>
): (...args: A) => Promise<R> {
  return (...args: A) => dispatch(name, (variant) => impl(...args, variant), options);
}
