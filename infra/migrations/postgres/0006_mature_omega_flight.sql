-- Intentionally empty. drizzle-kit generated this to catch its snapshot up with 0002-0005, which were
-- hand-written (site_segments, sessions_valid_after, index drops, public-dashboard index). Those changes are
-- already applied by 0002-0005, so repeating them fails with "relation already exists". The snapshot
-- (meta/0006_snapshot.json) is kept so the next `drizzle-kit generate` diffs against the true schema.
SELECT 1;
