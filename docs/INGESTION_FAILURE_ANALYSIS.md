# Ingestion Load Test: Why It Failed

Companion to the architecture diagram
[`ingestion-failure.html`](../.archify/architecture-ingest-failure-20261101-205225/ingestion-failure.html)
(source: `.archify/architecture-ingest-failure-20261101-205225/failure.json`).

This document explains, mechanism by mechanism, why the trackme ingestion path collapsed under the
load test. Every claim below is anchored to the code path or the measured numbers from that run.
The run itself was interrupted (the services were stopped), so stage summaries were never written;
the numbers below come from the running metrics plus post-hoc probes against the same services.

Defaults referenced here (`QUOTA_FAIL_OPEN=true`, the synchronous producer, `WORKER_WRITE_V2=off`)
describe the code as it was during the run. The target changes, including their current defaults,
are in [`INGESTION_FIX_PLAN.md`](./INGESTION_FIX_PLAN.md).

---

## 1. What the test asked for and what was measured

| Item | Value |
|---|---|
| Synthetic sites | 1,000 (`site_pub_e2e_*`) |
| Publish calls observed | ~7,262 |
| Messages that reached Kafka | 14,412 |
| Messages acknowledged to the edge | 1,714 |
| Rows inserted into `events_raw` | 8,156 |
| Messages left unconsumed when stopped | 6,252 (`14,412 - 8,160 consumed`) |
| Admission gate errors | 7,041 |
| Produce p50, 10 concurrent | ~4 s |
| Produce p50, 50 concurrent | ~11 s |
| ClickHouse insert | ~323 ms |
| PostgreSQL site lookup (warm) | ~47-86 ms |
| Effective delivery rate | ~30 events/s |

The three healthy numbers matter as much as the bad ones: ClickHouse at ~323 ms per batched insert
and PostgreSQL at ~50-85 ms warm were never the bottleneck. The failure was entirely in the request
path (remote Redis + synchronous Kafka) and in what happened after the produce error.

---

## 2. The path as built

The diagram shows the five-hop request path:

```
tracker -> edge -> kafka -> worker -> clickhouse
                ^      |
             redis  postgres
```

The edge handler was synchronous end to end. In `services/ingestion-go/internal/httpapi/server.go`
(line numbers are from the code as it was during the run):

1. `handleBatch` (line 193) accepted the batch.
2. `allowIP` (line 254) ran a Redis sliding-window `EVAL` for the per-IP limit
   (`internal/ratelimit/limiter.go:49`, script run at `:52`).
3. `processEvents` resolved the site from PostgreSQL (`internal/site/resolver.go:187`, cached
   resolve at `:217`) and ran a second Redis `EVAL` for the site rate limit, event-ID claims and
   quota (`internal/gate/gate.go:132`, script run at `:158`).
4. The handler published to Kafka synchronously (`server.go:557`) before it incremented the accepted
   counter (`server.go:579`).

The writer was configured in `services/ingestion-go/internal/queue/kafka.go` with
`RequiredAcks: RequireAll`, no async mode, and 3 s write/read timeouts, and the publisher applied a
4 s timeout. So every HTTP request waited on a remote Kafka quorum.

That is two remote Redis round trips and one remote Kafka quorum round trip per request, all inside
the request. With managed services in another region at ~100-140 ms RTT, the request has no budget
left once concurrency rises.

---

## 3. Failure mechanism 1: admission failed open

`go-redis` defaults the read timeout to 3 s. The gate is written to fail open on errors
(`QuotaFailOpen`), which is a reasonable choice for availability but a silent correctness hole here:
the IP limiter, the site rate limit, the event-ID claims (dedupe) and the quota all live behind the
same failing calls.

Measured: 7,041 gate errors against ~7,262 publish calls, i.e. ~97% of requests timed out inside
Redis and skipped admission. The consequences:

- Rate limits were not enforced.
- Dedupe claims were not claimed, so retries could duplicate.
- Quota was not charged.

Observability made this worse. The Redis error metric
`edge_redis_errors_total{op="gate"}` is shared by the IP limiter and the combined gate, so a single
series describes two different failing calls. A dashboard cannot tell which one is timing out.

The 300-concurrency probe was initially read as "Redis needs 14-16 s". That reading was wrong: a
single ioredis connection serializes commands. Measured separately:

- 300 sequential `PING`s over one connection: ~354 ms total.
- `EVAL` sequential p50: ~116 ms.
- 300 requests over 10 separate connections: ~231 ms.

So Redis is not pathologically slow; it is ~100-140 ms away, and synchronous double-`EVAL` amplifies
that to ~200-280 ms of remote work per request before Kafka is even attempted.

---

## 4. Failure mechanism 2: ambiguous produce timeouts lost and under-counted events

The synchronous `acks=all` producer timed out at 3 s / 4 s while Kafka still accepted many of those
records. The client could not tell success from failure, so it treated the produce as failed. The
handler then released the dedupe claims and quota that the gate had charged.

Measured outcome:

- 14,412 messages actually landed in Kafka.
- Only 1,714 were acknowledged to the edge and counted as accepted.
- About 27% of the events offered by the load generator never reached Kafka at all.

This is the worst of both worlds: the accepted counter under-reports by ~88% of what landed, retries
can re-send events whose claims were released, and there is no way to reconcile the two numbers
after the fact.

---

## 5. Failure mechanism 3: throughput collapse

Because the produce is in the request path and acks=all waits for all in-sync replicas:

| Concurrency | Produce p50 |
|---|---|
| 10 | ~4 s |
| 50 | ~11 s |

The edge effectively serialized on Kafka: ~30 events/s delivered. Two partitions on
`growth_events` also cap how much parallelism the consumer group can ever get; a single worker
consumer instance saturates at two partition readers no matter how fast ClickHouse is.

The 2 ms `BatchTimeout` and 500-record `BatchSize` in `queue/kafka.go` do not help here, because
`Async: false` means each `Publish` waits for its own write result.

---

## 6. Failure mechanism 4: the consumer stalled and the backlog went dark

The worker consumes with `eachBatch` (`services/event-worker/src/worker.ts:201`) and inserts into
ClickHouse with async inserts (`services/event-worker/src/writers/clickhouse.ts:116-118`). It
consumed 8,160 messages, inserted 8,156 rows, then stalled with 6,252 messages unconsumed.

The lag gauge could not show this. `consumerLag.set(...)` is called only after a batch completes
(`worker.ts:176`), so between batches — and especially during a stall — the gauge keeps its last
value. With the consumer stuck it read 0, which looks like "caught up". There is no periodic lag
sample and no queue-depth signal from the producer side.

When the worker restarts, those 6,252 test messages will be delivered into `events_raw`. Remove them
afterwards with:

```sql
ALTER TABLE events_raw DELETE WHERE site_key LIKE 'site_pub_e2e_%'
```

---

## 7. Failure mechanism 5: aggregates were silently empty

`WORKER_WRITE_V2` defaults to `off` (`packages/config/src/index.ts:93`). With it off, the worker
writes only `events_raw`. Every table fed by `events_v2` — `site_daily_agg`, `session_day_agg` and
the rest of the materialized-view chain — stays empty.

Nothing in the load test path fails because of this; the data just is not there. That is why the
diagram marks the `events_v2 / aggregates` node with `WORKER_WRITE_V2 = off` and `0 rows` rather
than drawing a broken edge. It is a configuration gap, not a runtime error.

---

## 8. What was not the problem

- **ClickHouse**: ~323 ms per batched insert; it accepted everything the worker sent.
- **PostgreSQL**: ~47-86 ms warm lookups; the site cache was doing its job.
- **Tracker SDK**: `fetch` at `packages/tracker/src/transport.ts:292` with the beacon fallback at
  `:306-307` behaved normally; it was waiting on the edge.
- **Kafka capacity**: the broker accepted 14,412 records; the cost was the synchronous
  acknowledgment path, not storage.

---

## 9. Measurement caveats

- ClickHouse `received_at` is stamped by the edge at the start of `processEvents`, after the IP
  limiter — it is *not* insert time. The ~116 ms p50 attributed to it is client-to-edge plus
  limiter time, not end-to-end delivery latency. True end-to-end SLO data does not exist yet; that
  is itself one of the findings.
- The load run was stopped before stage summaries were persisted. Figures here come from the
  running Prometheus metrics, the load harness counters, and direct probes against the same
  services.
- The EVAL concurrency probe measures one connection, so it overstates Redis latency unless
  connection-pool behavior is also measured. Both numbers are reported above.

---

## 10. Diagram map

| Node | What it asserts | Source |
|---|---|---|
| Ingestion Edge | 2 EVALs and a synchronous publish per request | `internal/httpapi/server.go:193,254,557` |
| Valkey | 3 s timeout leading to fail-open; 7,041 errors | `ratelimit/limiter.go:49`, `gate/gate.go:132` |
| Kafka | 2 partitions, acks=all, p50 4 s at 10 concurrent | `queue/kafka.go` (producer settings at run time) |
| Event Worker | 6,252 backlog at stop | `event-worker/src/worker.ts:201` |
| ClickHouse | 323 ms per insert, healthy | `writers/clickhouse.ts:116` |
| events_v2 | Write mode off, 0 rows | `packages/config/src/index.ts:93` |
| Metrics | Lag only set per batch, reads 0 | `worker.ts:176`, `metrics.ts:48` |

Fix proposal: [`INGESTION_FIX_PLAN.md`](INGESTION_FIX_PLAN.md) and
[`ingestion-fix.html`](../.archify/architecture-ingest-fixed-20261101-205225/ingestion-fix.html).
