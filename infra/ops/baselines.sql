-- Phase-0 baselines (optimization plan, section 12). Run before and after the cutover and
-- keep the output with the rollout notes, so storage and latency claims can be checked.
-- Replace growth_analytics with your CLICKHOUSE_DB.

-- 1. Storage per column, legacy table and v2 table.
SELECT table, column,
       formatReadableSize(sum(column_data_compressed_bytes))   AS compressed,
       formatReadableSize(sum(column_data_uncompressed_bytes)) AS raw
FROM system.parts_columns
WHERE database = 'growth_analytics' AND table IN ('events_raw', 'events_v2') AND active
GROUP BY table, column
ORDER BY table, sum(column_data_compressed_bytes) DESC;

-- 2. Rows scanned and duration per query shape, last 7 days.
SELECT normalizeQuery(query) AS q, count() AS n,
       quantile(0.95)(query_duration_ms) AS p95_ms,
       quantile(0.95)(read_rows)         AS p95_rows,
       quantile(0.95)(memory_usage)      AS p95_mem
FROM system.query_log
WHERE type = 'QueryFinish' AND event_time > now() - INTERVAL 7 DAY
GROUP BY q ORDER BY p95_ms DESC LIMIT 20;

-- 3. Duplicate event ids today (legacy and v2).
SELECT 'events_raw' AS tbl, count() - uniqExact(event_id) AS dups, dups / count() AS rate
FROM growth_analytics.events_raw WHERE timestamp >= today()
UNION ALL
SELECT 'events_v2', count() - uniqExact(event_id), (count() - uniqExact(event_id)) / count()
FROM growth_analytics.events_v2 WHERE timestamp >= today();

-- 4. Part pressure.
SELECT table, partition, count() AS parts
FROM system.parts WHERE active AND database = 'growth_analytics'
GROUP BY table, partition ORDER BY parts DESC LIMIT 20;

-- 5. Per-hour row counts, legacy vs v2, for the shadow-write go/no-go (must agree within 0.1 %).
SELECT l.h AS hour, l.n AS legacy, v.n AS v2, abs(l.n - v.n) / greatest(l.n, 1) AS gap
FROM (SELECT toStartOfHour(received_at) AS h, uniqExact(event_id) AS n FROM growth_analytics.events_raw
      WHERE received_at > now() - INTERVAL 48 HOUR GROUP BY h) AS l
LEFT JOIN (SELECT toStartOfHour(received_at) AS h, count() AS n FROM growth_analytics.events_v2
           WHERE received_at > now() - INTERVAL 48 HOUR GROUP BY h) AS v USING (h)
ORDER BY hour;
