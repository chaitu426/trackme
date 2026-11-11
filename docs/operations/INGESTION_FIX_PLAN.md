# Target Architecture: Ingestion That Survives the Load Test

Companion to the architecture diagram
[`ingestion-fix.html`](../../.archify/architecture-ingest-fixed-20261101-205225/ingestion-fix.html)
(source: `.archify/architecture-ingest-fixed-20261101-205225/fix.json`) and to
[`docs/operations/INGESTION_FAILURE_ANALYSIS.md`](INGESTION_FAILURE_ANALYSIS.md), which documents the measured
failure. Sections 2-4 describe the target; the code-level changes there are implemented (async queue,
fused admission, fail-closed policy, worker lag/e2e metrics, shadow writes). Same-region topology,
partition count and rollout remain operational work.

---

## 1. The one change that matters

Kafka leaves the request path. Admission becomes one same-region Redis call, the event is written
to a bounded in-process queue, and the HTTP response is `202 Accepted`. A background producer
drains that queue into Kafka in large batches. Everything else in this plan supports that change.

```
tracker -> edge -> [bounded queue] -> batch producer -> kafka -> worker -> clickhouse
                ^                                   |
             redis                             postgres (cache)
```

Topology requirement: edge, Valkey, PostgreSQL, Kafka, worker and ClickHouse in the same region
(ideally the same AZ set) so remote RTT stops being a per-request cost. At ~100-140 ms RTT the
current path cannot meet any SLO; under 5-10 ms it can.

---

## 2. Request path

| Step | Target |
|---|---|
| Admission | One fused `EVAL` per batch in Valkey: IP limit + site limit + event-ID claims + quota |
| Response | `202` as soon as the batch is enqueued, before any Kafka write |
| Queue full | `429` with `Retry-After`; never a multi-second request |
| Queue bound | ~10,000 events in memory; bounded so overload sheds load instead of growing |

Two implementation choices for admission:

1. **Fused remote EVAL (implemented).** The IP limiter (`internal/ratelimit/limiter.go`) and the
   combined gate (`internal/gate/gate.go`) used to be two scripts and two round trips; they are now
   one script that returns allow/deny plus the claimed event IDs atomically. Errors are labelled
   `op="ip"` or `op="gate"` so a failure still points at the right counter.
2. **Local counters with a circuit breaker (long term).** Keep per-edge token buckets in
   memory and reconcile with Valkey asynchronously. When the breaker opens, admission fails closed
   and alerts; it never silently allows traffic.

Failure mode changes from fail-open to **fail-closed and alerted**. A rejected request is visible
to the customer; an unchecked request is invisible corruption. Pair the change with a health signal
and an alert on `edge_admission_fail_closed_total` so the alert fires before the outage is user-visible.

---

## 3. Delivery path

| Concern | Current | Target |
|---|---|---|
| Producer | synchronous `acks=all` per request (`queue/kafka.go:52,57`) | background batched producer, 500-5,000 events per flush |
| Acknowledgment | waits on every request, 3 s timeout + 4 s publisher timeout | asynchronous; request already returned `202` |
| Partitions | 2 | at least 6, replication factor 3 |
| Retries | up to 3 attempts inside the request | bounded backoff in the background, with the same event IDs |
| Ambiguous result | claims and quota released (silent loss / duplication) | treat unknown outcome as "may have landed", retry, never refund |

Producer settings to evaluate:

- kafka-go v0.4.47 has no idempotent producer (`Writer.Idempotent` does not exist), and an
  idempotent producer would in any case require `acks=all`. So the implementable choice is
  **`acks=all`, batched, without producer-side idempotence**. This is affordable because batching
  moves the broker round trip off the request path: acks=all now costs background throughput, not
  request latency. Do not switch to `acks=1` to "enable idempotence"; it only weakens durability.
- `BatchSize` 500-5,000 and a flush interval (50-100 ms) sized against the produce p50 budget.
- Bounded producer queue with a metric on depth; when full, the edge's queue sheds with `429`.

Partition count is a throughput decision, not a tuning knob: with 2 partitions one consumer
instance can never exceed two in-flight partition readers. Six partitions gives the worker room to
scale horizontally and keeps per-partition commit latency low.

Idempotency still needs an edge claims table (event IDs) and the ClickHouse insert dedupe token as
a backstop. The target is: each event is admitted once, and a retried produce produces one row.

---

## 4. Worker and data

| Item | Change |
|---|---|
| Consumer | keep `eachBatch` (`worker.ts:201`) with explicit batch resolution; add bounded retries and a DLQ for poison events |
| Lag | sample consumer lag on a timer (5-10 s) via the admin client, independent of batch completion, plus a backlog-age alert |
| DLQ | `growth_events_dlq` with an alert and a replay path for rejected events |
| Write mode | `WORKER_WRITE_V2=shadow` (now the default), then `only` after reconciliation |
| Aggregates | `events_v2` feeds `site_daily_agg`, `session_day_agg` and the rest of the MV chain; shadow mode proves row counts before cutover |
| ClickHouse | keep batched async inserts (`writers/clickhouse.ts:116-118`); ~323 ms per batch was healthy |

The stale-gauge bug is not a dashboard problem: `consumerLag.set(...)` is only called after a batch
(`worker.ts:176`), so a stalled consumer reports `0`. A periodic sampler fixes the signal even when
the consumer is stuck.

---

## 5. Observability: define the SLO before tuning

The load test could not answer "what is end-to-end latency?" because no stage carried a shared
timestamp beyond `received_at`, which is stamped at the edge. Add:

1. **Edge receipt timestamp** at `handleBatch` entry, before admission.
2. **Queue enqueue/ack timestamp** so request latency and delivery latency are separable.
3. **Produce result** per batch: acked, ambiguous, rejected.
4. **ClickHouse insert timestamp** after a successful batch insert.
5. **E2E SLO**: p50/p95/p99 of `insert_ts - receipt_ts`, exported per site tier.
6. **Operational gauges**: queue depth, producer batch size, consumer lag (periodic), insert p95,
   DLQ rate, admission fail-closed count, 429 rate.

Dashboards should show the four stage boundaries separately; a single "request time" hides exactly
the failure mode that produced this incident.

---

## 6. Change list

| # | Change | Where | Status |
|---|---|---|---|
| 1 | Move managed Valkey/PG/Kafka/CH to the same region or AZ set | Infrastructure | Operational, not code |
| 2 | Fuse IP + site + claims + quota into one EVAL; separate metric labels | `gate/gate.go`, `httpapi/admit.go` | Done |
| 3 | Fail closed on admission errors + alert | `config`, `httpapi/admit.go`, `server.go` | Done (`ADMISSION_FAIL_CLOSED=true`) |
| 4 | Bounded in-process queue; `202` after enqueue; `429` when full | `queue/async.go`, `httpapi/server.go` | Done (`EDGE_ASYNC_PRODUCE=true`) |
| 5 | Batched background producer (500-5,000), acks=all, no producer idempotence | `queue/kafka.go`, `queue/async.go` | Done |
| 6 | Partition count to 6+ with RF 3 | Kafka topic config | Operational; still 2 locally |
| 7 | Ambiguous produce outcome: retry, never refund claims/quota | `queue/async.go` | Done in the queue; partial writes keep landed events |
| 8 | Periodic lag sampler + backlog-age alert | `event-worker/src/worker.ts`, `metrics.ts` | Done (`WORKER_LAG_SAMPLE_MS`) |
| 9 | DLQ alert + replay | worker / `alerts.yml` | Alert exists; replay is manual |
| 10 | `WORKER_WRITE_V2=shadow`, then `only` | `packages/config` | Default is `shadow`; `only` after reconciliation |
| 11 | E2E receipt/insert timestamps and SLO metrics | `event-worker/src/worker.ts` | Done (`worker_e2e_latency_seconds`) |

Suggested order: 1, 8 and 11 first (visibility), then 2-3 (correctness), then 4-7 (throughput),
then 9-10 (data completeness).

---

## 7. Acceptance criteria

Re-run the same 1,000-site load test and require:

| Metric | Target |
|---|---|
| Edge server-side latency | p50 ≤ 15 ms, p99 ≤ 50 ms (matches `docs/architecture/ARCHITECTURE_OPTIMIZATION_PLAN.md`) |
| Admission fail-open | 0; every Redis failure returns `503` and increments `edge_admission_fail_closed_total` |
| Acked vs landed vs inserted | acked = inserted within dedupe tolerance; no unexplained gap |
| Throughput | ≥ 500 events/s sustained at the tested concurrency |
| Consumer lag | < 10 s at steady state; backlog-age alert wired |
| Queue behavior | overload produces `429 + Retry-After`, not timeouts |
| Aggregates | `events_v2` and MV tables non-empty in shadow before `only` |
| SLO visibility | e2e p95 available from edge receipt to ClickHouse insert |

---

## 8. Tradeoffs and open questions

- **No idempotent producer.** kafka-go v0.4.47 has no `Writer.Idempotent`; the plan keeps
  `acks=all` and relies on edge event-ID claims plus the ClickHouse insert dedupe token for
  exactly-once *rows*. Confirm the broker's `min.insync.replicas` before relying on acks=all alone.
- **Fail-closed admission** trades availability for correctness. The circuit breaker and alert must
  distinguish "Redis down" from "site over quota" so on-call can act.
- **In-process queue** loses its contents if the edge crashes. Bounded size plus fast drain keeps
  the window small; a durable WAL is the alternative if zero-loss is required.
- **Same-region move** is the highest-leverage change and the least code. If it cannot happen,
  the queue + async producer still helps, but admission will remain RTT-bound.
- **Partition count** should be chosen with the 30-day peak in mind; increasing later is easy but
  rebalances consumers.
