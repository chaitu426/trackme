-- ==============================================================================
-- ClickHouse Migration: size the insert-dedupe window for restart time, not block count
--
-- events_v2 remembers the hash of its last N inserted blocks and silently drops a re-insert of
-- the same block (the worker's insert_deduplication_token). N was 1000: at 40 inserts/s that is
-- 25 seconds, so a worker that restarts after a minute replays outside the window and duplicates.
-- Rule: N >= restart_budget_seconds x inserts_per_second. With the writer's ~1 insert/s per pod,
-- 10 pods and a 15 minute budget that is 9,000; 20,000 leaves headroom. Memory cost: one hash per block.
--
-- If production uses ReplicatedMergeTree, set replicated_deduplication_window and
-- replicated_deduplication_window_seconds instead (this table is plain MergeTree).
-- ==============================================================================

ALTER TABLE growth_analytics.events_v2 MODIFY SETTING non_replicated_deduplication_window = 20000;
