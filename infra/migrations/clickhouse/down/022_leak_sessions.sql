-- Rollback of 022. leak_sessions is derived from events, orders, payments and errors, so it can be rebuilt: re-apply 022 and the
-- rollup job recomputes today and yesterday; older days come back with `node --import tsx seed-...` style backfill or the job's backfill option.
DROP TABLE IF EXISTS growth_analytics.leak_sessions;
