import { test } from "node:test";
import assert from "node:assert/strict";
import type { MetricQueryRequest } from "@trackme/contracts";
import { buildRollupOverviewQueries } from "./overview.js";

const WS = "0b9f6a64-0d1f-4f3a-9c55-2d4f5c0f8a11";
const SITE = "a1c2e3f4-1111-4222-8333-444455556666";

function request(from: string, to: string): MetricQueryRequest {
  return { workspaceId: WS, siteId: SITE, dateRange: { from, to } } as MetricQueryRequest;
}

const placeholders = (sql: string) => [...sql.matchAll(/\{(\w+):/g)].map((m) => m[1] as string);

test("a rolling 7-day range is split into whole days and two raw edges", () => {
  const q = buildRollupOverviewQueries(request("2026-10-03T15:20:00.000Z", "2026-10-10T15:20:00.000Z"));
  assert.ok(q);
  assert.equal(q.uniques.params.fullFrom, "2026-10-04");
  assert.equal(q.uniques.params.fullTo, "2026-10-10");
  assert.equal(q.uniques.params.headEnd, "2026-10-04 00:00:00.000");
  assert.equal(q.uniques.params.tailStart, "2026-10-10 00:00:00.000");
});

test("a range with no whole day returns null so the caller reads raw events", () => {
  assert.equal(buildRollupOverviewQueries(request("2026-10-10T01:00:00.000Z", "2026-10-10T20:00:00.000Z")), null);
});

test("every placeholder in every query has a value", () => {
  const q = buildRollupOverviewQueries(request("2026-09-10T08:00:00.000Z", "2026-10-10T08:00:00.000Z"));
  assert.ok(q);
  for (const built of [q.uniques, q.pageviews, q.engagement]) {
    for (const name of placeholders(built.query)) {
      assert.ok(name in built.params, `placeholder {${name}} has no parameter`);
    }
  }
});

test("every query is scoped to one workspace and site", () => {
  const q = buildRollupOverviewQueries(request("2026-09-10T08:00:00.000Z", "2026-10-10T08:00:00.000Z"));
  assert.ok(q);
  for (const built of [q.uniques, q.pageviews, q.engagement]) {
    const scoped = built.query.match(/workspace_id = \{workspaceId:UUID\} AND site_id = \{siteId:UUID\}/g) ?? [];
    const sources = built.query.match(/\bFROM (daily_uniques|pageview_rollups_daily|session_engagement_daily|events_raw)\b/g) ?? [];
    assert.equal(scoped.length, sources.length, "each table read must carry the tenant filter");
    assert.ok(sources.length >= 2);
  }
});

test("rollup tables are read with FINAL because replacement only happens at merge time", () => {
  const q = buildRollupOverviewQueries(request("2026-09-10T08:00:00.000Z", "2026-10-10T08:00:00.000Z"));
  assert.ok(q);
  assert.match(q.uniques.query, /FROM daily_uniques FINAL/);
  assert.match(q.pageviews.query, /FROM pageview_rollups_daily FINAL/);
  assert.match(q.engagement.query, /FROM session_engagement_daily FINAL/);
});

test("visitors and sessions are merged from states, not summed across days", () => {
  const q = buildRollupOverviewQueries(request("2026-09-10T08:00:00.000Z", "2026-10-10T08:00:00.000Z"));
  assert.ok(q);
  assert.match(q.uniques.query, /uniqCombined64Merge\(v\)/);
  assert.match(q.uniques.query, /uniqCombined64Merge\(s\)/);
  assert.doesNotMatch(q.uniques.query, /sum\(/);
});

test("bots are excluded from every raw read", () => {
  const q = buildRollupOverviewQueries(request("2026-09-10T08:00:00.000Z", "2026-10-10T08:00:00.000Z"));
  assert.ok(q);
  for (const built of [q.uniques, q.pageviews, q.engagement]) {
    const raw = built.query.slice(built.query.indexOf("FROM events_raw"));
    assert.match(raw, /bot_status = 'human'/);
  }
});

test("the two edges are never merged into one session", () => {
  const q = buildRollupOverviewQueries(request("2026-09-10T08:00:00.000Z", "2026-10-10T08:00:00.000Z"));
  assert.ok(q);
  assert.match(q.engagement.query, /GROUP BY session_id, timestamp >= \{tailStart:DateTime64\}/);
});

test("the unfinished current day is never read from rollups", () => {
  // `to` is mid-day on Oct 10, so Oct 10 must come from raw events, not a partial rollup.
  const q = buildRollupOverviewQueries(request("2026-10-03T00:00:00.000Z", "2026-10-10T09:00:00.000Z"));
  assert.ok(q);
  assert.equal(q.pageviews.params.fullTo, "2026-10-10");
  assert.match(q.pageviews.query, /date < \{fullTo:Date\}/);
});
