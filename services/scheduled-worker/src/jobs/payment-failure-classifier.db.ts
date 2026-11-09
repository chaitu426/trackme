import { getClickHouseClient } from "@trackme/analytics";
import type { ClassifiedRow, ClassifierDeps, ErrorHit, Outcome, PendingFailure } from "./payment-failure-classifier.js";

type Client = Pick<ReturnType<typeof getClickHouseClient>, "query" | "insert">;

const toCH = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

async function rows<T>(client: Client, query: string, params: Record<string, unknown>): Promise<T[]> {
  const rs = await client.query({ query, query_params: params, format: "JSONEachRow" });
  return rs.json<T>();
}

/**
 * The ClickHouse side of the classifier. Every query is bounded: failures by a lookback window and a row limit, context by the time
 * span of the batch and the sites in it. Aliases are chosen so they never shadow the columns they are computed from.
 */
export function createClickHouseClassifierDeps(client: Client = getClickHouseClient()): ClassifierDeps {
  return {
    async fetchPending(limit, lookbackHours) {
      const found = await rows<Record<string, string>>(
        client,
        `SELECT toString(workspace_id) AS wk, toString(site_id) AS st, payment_id AS pid,
                argMaxIf(order_id, created_at, order_id != '') AS ord,
                any(gateway) AS gw,
                argMax(method, created_at) AS mth,
                argMaxIf(amount_minor, created_at, status = 'failed') AS amt,
                any(currency) AS cur,
                argMaxIf(failure_code_raw, created_at, status = 'failed') AS code_raw,
                argMaxIf(user_ref, created_at, user_ref != '') AS usr,
                toUnixTimestamp64Milli(maxIf(created_at, status = 'failed')) AS failed_ms,
                toUnixTimestamp64Milli(minIf(created_at, status IN ('created', 'authorized'))) AS started_ms
         FROM growth_analytics.payment_events FINAL
         WHERE created_at >= now() - toIntervalHour({lookback:UInt32}) AND created_at <= now()
         GROUP BY workspace_id, site_id, payment_id
         HAVING countIf(status = 'failed') > 0
            AND countIf(status = 'captured') = 0
            AND maxIf(created_at, status = 'failed') < now64(3) - toIntervalSecond(60)
            AND (site_id, payment_id) NOT IN (
              SELECT site_id, payment_id FROM growth_analytics.payment_failure_class
              WHERE failed_at >= now() - toIntervalHour({lookback:UInt32} + 1))
         ORDER BY failed_ms
         LIMIT {limit:UInt32}`,
        { lookback: lookbackHours, limit }
      );
      return found.map((r): PendingFailure => {
        const started = Number(r.started_ms);
        return {
          workspaceId: r.wk!, siteId: r.st!, paymentId: r.pid!, orderId: r.ord ?? "", gateway: r.gw!, method: r.mth!,
          amountMinor: Number(r.amt), currency: r.cur!, code: r.code_raw ?? "", userRef: r.usr ?? "",
          failedAtMs: Number(r.failed_ms), startedAtMs: started > 0 ? started : null,
        };
      });
    },

    async fetchSessions(failures) {
      const withOrder = failures.filter((f) => f.orderId);
      if (withOrder.length === 0) return new Map();
      const found = await rows<{ s: string; o: string; h: string }>(
        client,
        `SELECT toString(site_id) AS s, order_id AS o, toString(session_hash) AS h
         FROM growth_analytics.order_session FINAL
         WHERE site_id IN {sites:Array(UUID)} AND order_id IN {orders:Array(String)}`,
        { sites: [...new Set(withOrder.map((f) => f.siteId))], orders: [...new Set(withOrder.map((f) => f.orderId))] }
      );
      return new Map(found.map((r) => [`${r.s}:${r.o}`, r.h]));
    },

    async fetchErrors(pairs, fromMs, toMs): Promise<ErrorHit[]> {
      if (pairs.length === 0) return [];
      const found = await rows<{ s: string; h: string; t: string }>(
        client,
        `SELECT toString(site_id) AS s, toString(session_hash) AS h, toUnixTimestamp64Milli(timestamp) AS t
         FROM growth_analytics.events_v2
         WHERE site_id IN {sites:Array(UUID)} AND type = 'error'
           AND toDate(timestamp) >= toDate({from:DateTime64(3)}) AND toDate(timestamp) <= toDate({to:DateTime64(3)})
           AND timestamp >= {from:DateTime64(3)} AND timestamp <= {to:DateTime64(3)}
           AND session_hash IN (SELECT arrayJoin(arrayMap(x -> toUInt64(x), {hashes:Array(String)})))`,
        { sites: [...new Set(pairs.map((p) => p.siteId))], hashes: [...new Set(pairs.map((p) => p.sessionHash))], from: toCH(fromMs), to: toCH(toMs) }
      );
      const wanted = new Set(pairs.map((p) => `${p.siteId}|${p.sessionHash}`));
      return found.filter((r) => wanted.has(`${r.s}|${r.h}`)).map((r) => ({ siteId: r.s, sessionHash: r.h, atMs: Number(r.t) }));
    },

    async fetchOutcomes(pairs, fromMs, toMs): Promise<Outcome[]> {
      if (pairs.length === 0) return [];
      const found = await rows<{ s: string; gw: string; t: string; p: number }>(
        client,
        `SELECT toString(site_id) AS s, gateway AS gw, toUnixTimestamp64Milli(done_at) AS t, was_paid AS p
         FROM (
           SELECT site_id, gateway, payment_id,
                  max(status = 'captured') AS was_paid,
                  maxIf(created_at, status IN ('captured', 'failed')) AS done_at
           FROM growth_analytics.payment_events FINAL
           WHERE site_id IN {sites:Array(UUID)}
             AND toDate(created_at) >= toDate({from:DateTime64(3)}) AND toDate(created_at) <= toDate({to:DateTime64(3)})
             AND created_at >= {from:DateTime64(3)} AND created_at <= {to:DateTime64(3)}
           GROUP BY site_id, gateway, payment_id
           HAVING max(status IN ('captured', 'failed')) = 1
         )`,
        { sites: [...new Set(pairs.map((p) => p.siteId))], from: toCH(fromMs), to: toCH(toMs) }
      );
      return found.map((r) => ({ siteId: r.s, gateway: r.gw, atMs: Number(r.t), paid: Number(r.p) === 1 }));
    },

    async save(batch: ClassifiedRow[]) {
      if (batch.length === 0) return;
      await client.insert({
        table: "growth_analytics.payment_failure_class",
        format: "JSONEachRow",
        values: batch.map((r) => ({
          workspace_id: r.workspaceId, site_id: r.siteId, payment_id: r.paymentId, order_id: r.orderId, gateway: r.gateway, method: r.method,
          amount_minor: r.amountMinor, currency: r.currency, failure_code_raw: r.code, user_ref: r.userRef,
          failed_at: new Date(r.failedAtMs).toISOString(), category: r.category, rule_id: r.ruleId, rules_version: r.rulesVersion,
          session_error: r.sessionError ? 1 : 0, gateway_rate: r.gatewayRate, gateway_volume: r.gatewayVolume, seconds_to_fail: r.secondsToFail,
        })),
        clickhouse_settings: { date_time_input_format: "best_effort" },
      });
    },
  };
}
