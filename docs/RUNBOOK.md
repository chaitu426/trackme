# Runbook

One section per alert in `infra/observability/alerts.yml`. Each says what the alert means, the first thing to
look at, and a mitigation that is safe to try before escalating. ClickHouse queries run in the Aiven console's
query editor (or `clickhouse-client`); replace `growth_analytics` with your `CLICKHOUSE_DB`.

## Ingestion 5xx
**Means:** the edge (`ingestion-go`) is returning 5xx on `/v1/batch`; events from browsers are being lost or retried.
**Look first:** `edge_kafka_publish_errors_total` (Kafka), `edge_redis_errors_total` (Redis), then the edge log for
`quota`/`gate` lines. `GET :3001/health` tells you the process is alive, not that its dependencies are.
**Mitigate:** the edge now fails closed by default (`ADMISSION_FAIL_CLOSED=true`, `QUOTA_FAIL_OPEN=false`), so a
Redis failure returns `503` instead of silently skipping limits; restore Redis and the SDK retries. Setting
`ADMISSION_FAIL_CLOSED=false` restores the old fail-open behaviour and should only be a deliberate, alerted choice.
If it is Kafka, see below. Scale edge replicas only if latency, not errors, is the symptom.

## Kafka publish errors
**Means:** the edge cannot write to Kafka. Senders get 500 and retry, so nothing is lost until their retry budget ends.
**Look first:** Aiven Kafka service state and `edge_kafka_publish_duration_seconds`. A `POLICY_VIOLATION` or
`UNKNOWN_TOPIC` means the topic is missing or over the plan limit (`node infra/aiven/create-kafka-topics.mjs`).
TLS or SASL errors mean `KAFKA_*` credentials or the CA file changed.
**Mitigate:** restore the broker or credentials. Do not raise `KAFKA_COMPRESSION` to a codec the worker cannot read
(the worker decodes zstd and gzip only).

## Admission fail-closed (Redis outage)
**Means:** Redis errors at the edge. With `ADMISSION_FAIL_CLOSED=true` (default), quota, dedupe and the fused
IP/site gate cannot be verified, so `/v1/batch` returns `503` and the tracker retries. No duplicates or over-quota
events are admitted. `edge_admission_fail_closed_total{stage}` shows whether the gate or the quota call failed.
**Look first:** Valkey service health and memory; `valkey_maxmemory_policy` must be `noeviction`. Check
`edge_redis_errors_total{op="gate"|"ip"}` and the per-op latency; the edge uses a 2 s Redis timeout.
**Mitigate:** restore Redis; retries resume automatically. Only if the outage is prolonged and losing events is
worse than unbounded usage, temporarily set `ADMISSION_FAIL_CLOSED=false` (old fail-open behaviour). Duplicates
admitted that way are collapsed by the dedupe token on insert and by nightly reconciliation.

## Queue backpressure (429)
**Means:** the edge's in-process publish queue is full (`EDGE_ASYNC_PRODUCE=true`) and Kafka is not draining it.
Clients receive `429` with `Retry-After`.
**Look first:** `edge_publish_queue_depth`, `edge_publish_queue_overflows_total`, and
`edge_publish_outcomes_total{outcome="retried"|"dropped"}`. Then check Kafka broker health and partitions.
**Mitigate:** restore Kafka throughput or add partitions (≥6, RF 3). Do not raise the queue cap without fixing
the drain rate, or memory grows while latency stays bad.

## Consumer lag
**Means:** the event worker is behind Kafka. The dashboard shows data later than it happened.
**Look first:** `worker_consumer_lag` (sampled every `WORKER_LAG_SAMPLE_MS`, default 5 s, independent of batch
completion) and the backlog age; `worker_insert_duration_seconds` (slow ClickHouse inserts), `worker_batch_rows`,
worker logs for `Crash` or `Connection timeout`. Lag with healthy inserts means too few consumers: partitions are 2
on the free plan, so `WORKER_PARTITION_CONCURRENCY x replicas` above 2 buys nothing. Raise the topic to ≥6 partitions.
**Mitigate:** restart a stuck worker (offsets are only committed after a durable insert, so nothing is lost). If
ClickHouse is slow, check parts (below) and `async_insert` settings. Do not skip offsets.

## Dead letters
**Means:** messages failed validation or were refused by ClickHouse and went to `KAFKA_DLQ_TOPIC`.
**Look first:** `worker_dlq_total{reason}`: `malformed` (bad JSON), `contract` (schema violation, usually a tracker
or edge version mismatch), `clickhouse_rejected` (a row ClickHouse will not store).
**Mitigate:** read a few messages from the DLQ topic, fix the producer or schema, then replay them. A sudden `contract`
spike right after a deploy means roll back the edge or tracker.

## Shadow write failing
**Means:** with `WORKER_WRITE_V2=shadow`, inserts into `events_ingest` fail while legacy inserts succeed, so v2 is falling
behind.
**Look first:** the worker log line `Shadow write to events_ingest failed` and the error. Usually a missing migration
(`node infra/aiven/migrate-clickhouse.mjs`) or a column mismatch after a schema change.
**Mitigate:** fix and carry on; the per-day count comparison in `scripts/backfill-events-v2.ts --dry-run` shows what is
missing. Set `WORKER_WRITE_V2=off` to stop writing v2 without affecting dashboards.

## Too many parts
**Means:** a partition has many small active parts; ClickHouse refuses inserts at the hard limit (default 300).
**Look first:**
```sql
SELECT table, partition, count() AS parts FROM system.parts
WHERE active AND database = 'growth_analytics' GROUP BY table, partition ORDER BY parts DESC LIMIT 10;
```
**Mitigate:** raise `WORKER_FETCH_MIN_BYTES` / `WORKER_FETCH_MAX_WAIT_MS` so each insert is larger, keep
`CLICKHOUSE_ASYNC_INSERT=true`, and let merges catch up. `OPTIMIZE TABLE ... FINAL` is a last resort on a busy table.

## Dashboard slow
**Means:** a dashboard route's p95 is high or the cache is not absorbing load.
**Look first:** which `route` in `web_route_duration_seconds`; `query_cache_total` hit ratio; ClickHouse query log:
```sql
SELECT normalizeQuery(query) AS q, count() AS n, quantile(0.95)(query_duration_ms) AS p95_ms,
       quantile(0.95)(read_rows) AS p95_rows
FROM system.query_log WHERE type = 'QueryFinish' AND event_time > now() - INTERVAL 1 HOUR
GROUP BY q ORDER BY p95_ms DESC LIMIT 10;
```
**Mitigate:** a high `read_rows` means a query is scanning raw events: check `ANALYTICS_READ` (v2 reads the aggregate
tables) and that the cache Redis is reachable. A 422 `RANGE_TOO_WIDE` is the raw-scan guard doing its job.

## Shadow read differences
**Means:** with `ANALYTICS_READ=shadow`, v2 returned a different answer from v1 for the named query.
**Look first:** the web log line `[analytics-shadow] <query> differs: ...` shows the fields and both values.
**Mitigate:** explained differences (referrers are domains in v2, t-digest p75 is approximate, a session crossing
midnight) are tolerated by design. Anything else means the aggregates are missing data: run the reconciliation job
below and the backfill dry run. Stay on `v1` until a week is clean.

## Scheduled job stale
**Means:** a scheduled job (`hourly_rollups`, `daily_rollups`, `usage_metering`, `quota_reclaim`) has not succeeded for an hour. (`retention` and `reconciliation` run daily and have their own alerts.)
**Look first:** scheduler logs for the task; `scheduled_job_runs_total{result="failure"}`; Redis keys `lock:scheduled:*`
(a lock left by a crashed run expires on its own).
**Mitigate:** fix the cause (ClickHouse reachable? migrations applied?) and the next tick catches up: daily rollups resume
from where the table ends.

## Retention not run
**Means:** the nightly retention job has not succeeded in 36 hours. Table TTLs are only a 60-month ceiling, so until it
runs again sites keep data longer than they configured.
**Look first:** scheduler log for `Retention:`. A failure message starts with the count of failed statements and the first
error (for example `too many mutations`); `Retention skipped: N ClickHouse mutations are still pending` means a backlog,
check `SELECT * FROM system.mutations WHERE is_done = 0` and let it drain or kill stuck ones.
**Mitigate:** fix the cause and re-run; it is idempotent (deleting rows that are already gone is a no-op).

## Reconciliation
**Means:** the nightly check found aggregate tables that disagree with raw events (beyond 0.5 % pageviews, 2 % visitors),
or duplicate event ids above 0.1 % of a day.
**Look first:** the scheduler log lines `reconciliation <day> site=... <kind>`.
**Mitigate:** `missing_aggregate` after a deploy usually means events landed in `events_v2` before the aggregate tables
existed: rebuild that day. **Never insert a second copy into a live aggregate table**: sum columns would double. Clear
the day from `events_v2` and the aggregates, then re-run `scripts/backfill-events-v2.ts` for that day. Duplicates above the
limit mean edge dedupe (`EDGE_DEDUPE`) is off or Redis is dropping claims.

## Realtime stream drops (SSE hosting)
**Means:** dashboards using the live stream reconnect every few seconds or never receive updates.
**Look first:** whether a proxy or CDN in front of the web app buffers or times out long-lived responses. The stream
route sends a heartbeat every 25 s and a `retry: 10000` hint when a site already has 200 listeners.
**Mitigate:** disable response buffering for `/api/v1/sites/*/realtime/stream` (for nginx `proxy_buffering off;` and a
read timeout above 60 s), and avoid serverless hosts that cap response time: run the web app as a long-running Node
process.
