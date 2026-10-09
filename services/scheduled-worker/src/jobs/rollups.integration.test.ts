/**
 * Integration test for migrations 001-007, the daily rollup job and the rollup
 * overview query, against a REAL ClickHouse.
 *
 * It is skipped unless CLICKHOUSE_TEST_URL is set, so the normal test run never
 * needs a database. To run it:
 *
 *   docker run -d --name ch-test -p 18123:8123 clickhouse/clickhouse-server:24-alpine
 *   CLICKHOUSE_TEST_URL=http://localhost:18123 pnpm --filter @trackme/scheduled-worker test:integration
 *
 * Optional: CLICKHOUSE_TEST_USER (default "default"), CLICKHOUSE_TEST_PASSWORD.
 *
 * Everything happens in a throwaway database that is dropped at the end. It never
 * touches growth_analytics.
 *
 * What it proves, in order:
 *   1. every migration file applies cleanly, in order, on an empty server
 *   2. web_vitals dedupes a redelivered event (migration 006)
 *   3. the rollup overview equals both the raw-SQL overview and a plain-JS
 *      calculation, for a rolling 7-day and a rolling 30-day range
 *   4. running the job twice changes nothing
 *   5. wiping a rollup table and running again repairs it (downtime recovery)
 *   6. today's unfinished day and the first partial day are counted exactly
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const URL_ = process.env.CLICKHOUSE_TEST_URL;
const USER = process.env.CLICKHOUSE_TEST_USER ?? "default";
const PASSWORD = process.env.CLICKHOUSE_TEST_PASSWORD ?? "";
const skip = !URL_ ? "set CLICKHOUSE_TEST_URL to run against a real ClickHouse" : false;

const DB = `it_${randomBytes(4).toString("hex")}`;
const WS = "0b9f6a64-0d1f-4f3a-9c55-2d4f5c0f8a11";
const SITE = "a1c2e3f4-1111-4222-8333-444455556666";
const NOW = new Date("2026-10-10T12:00:00.000Z");

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, "../../../../infra/migrations/clickhouse");

async function ch(sql: string, body?: string): Promise<string> {
  const target = new URL(URL_ as string);
  target.searchParams.set("query", sql);
  const res = await fetch(target, {
    method: "POST",
    headers: { "X-ClickHouse-User": USER, "X-ClickHouse-Key": PASSWORD },
    body: body ?? "",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${text.slice(0, 400)}\n  while running: ${sql.slice(0, 200)}`);
  return text;
}

async function rows<T>(sql: string): Promise<T[]> {
  const text = await ch(`${sql} FORMAT JSONEachRow`);
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}

function statements(file: string): string[] {
  const sql = readFileSync(path.join(MIGRATIONS, file), "utf8")
    .replaceAll("growth_analytics", DB)
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return sql.split(";").map((s) => s.trim()).filter(Boolean);
}

// ---- synthetic traffic -------------------------------------------------------

type Ev = {
  event_id: string;
  workspace_id: string;
  site_id: string;
  site_key: string;
  timestamp: string;
  type: string;
  event_name: string;
  session_id: string;
  visitor_pseudonym: string;
  url: string;
  path: string;
  title: string;
  referrer: string;
  country: string;
  browser: string;
  os: string;
  device: string;
  bot_status: string;
};

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;
const chTime = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "");

function event(at: Date, session: string, visitor: string, bot = false): Ev {
  return {
    event_id: uuid(),
    workspace_id: WS,
    site_id: SITE,
    site_key: "site_key_12345",
    timestamp: chTime(at),
    type: "pageview",
    event_name: "pageview",
    session_id: session,
    visitor_pseudonym: visitor,
    url: "https://example.com/p",
    path: "/p",
    title: "",
    referrer: "",
    country: "US",
    browser: "Chrome",
    os: "Windows",
    device: "desktop",
    bot_status: bot ? "known_bot" : "human",
  };
}

/** 33 days of traffic ending on NOW's day. Sessions stay inside one UTC day (08:00 to 20:00). */
function traffic(): Ev[] {
  const out: Ev[] = [];
  for (let back = 32; back >= 0; back--) {
    const day = new Date(Date.UTC(2026, 9, 10 - back));
    const visitors = 2 + (back % 3);
    for (let j = 0; j < visitors; j++) {
      // Even visitors return every day under the same id; the rest are one-off.
      const visitor = j % 2 === 0 ? `returning-${j}` : `once-${back}-${j}`;
      const session = `s-${back}-${j}`;
      const views = 1 + ((back + j) % 3); // 1 view is a bounce
      const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 8 + j * 2, 5 * j);
      for (let k = 0; k < views; k++) out.push(event(new Date(start + k * 40_000), session, visitor));
    }
    // A bot every day; it must never appear in any number.
    out.push(event(new Date(Date.UTC(2026, 9, 10 - back, 9, 0)), `bot-${back}`, `bot-v-${back}`, true));
  }
  return out;
}

type Expected = { visitors: number; sessions: number; pageviews: number; bounce: number; avgDuration: number };

/** The answer computed from the events alone, with no SQL. */
function expected(events: Ev[], from: Date, to: Date): Expected {
  const inRange = events.filter((e) => {
    const t = Date.parse(e.timestamp.replace(" ", "T") + "Z");
    return e.bot_status === "human" && t >= from.getTime() && t <= to.getTime();
  });
  const bySession = new Map<string, number[]>();
  for (const e of inRange) {
    const t = Date.parse(e.timestamp.replace(" ", "T") + "Z");
    bySession.set(e.session_id, [...(bySession.get(e.session_id) ?? []), t]);
  }
  let bounced = 0;
  let duration = 0;
  for (const times of bySession.values()) {
    if (times.length === 1) bounced += 1;
    duration += Math.round((Math.max(...times) - Math.min(...times)) / 1000);
  }
  const sessions = bySession.size;
  return {
    visitors: new Set(inRange.map((e) => e.visitor_pseudonym)).size,
    sessions,
    pageviews: inRange.length,
    bounce: sessions ? Math.round((bounced / sessions) * 1000) / 10 : 0,
    avgDuration: sessions ? Math.round(duration / sessions) : 0,
  };
}

// ---- the test ----------------------------------------------------------------

type Analytics = typeof import("@trackme/analytics");
type Jobs = typeof import("./daily-rollups.js");

let analytics: Analytics;
let jobs: Jobs;
const events: Ev[] = [];
const settings = { lookbackDays: 2, backfillDays: 65, maxDaysPerRun: 100 };

before(
  async () => {
    if (skip) return; // hooks ignore the skip option, so guard here
    await ch(`CREATE DATABASE ${DB}`);
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
      for (const stmt of statements(file)) await ch(stmt);
    }

    events.push(...traffic());
    await ch(`INSERT INTO ${DB}.events_raw FORMAT JSONEachRow`, events.map((e) => JSON.stringify(e)).join("\n"));

    // The analytics client reads its connection from the environment on import.
    const target = new URL(URL_ as string);
    process.env.CLICKHOUSE_URL = `${target.protocol}//${target.host}`;
    process.env.CLICKHOUSE_USER = USER;
    process.env.CLICKHOUSE_PASSWORD = PASSWORD;
    process.env.CLICKHOUSE_DB = DB;
    analytics = await import("@trackme/analytics");
    jobs = await import("./daily-rollups.js");

    await jobs.runDailyRollups({ now: NOW, settings });
  }
);

after(async () => {
  if (skip) return;
  await ch(`DROP DATABASE IF EXISTS ${DB}`);
});

async function overview(from: Date, to: Date, viaRaw = false) {
  return analytics.getOverviewMetrics({
    workspaceId: WS,
    siteId: SITE,
    dateRange: { from: from.toISOString(), to: to.toISOString() },
    // An empty filter object routes the request to the raw-events query, which is the reference answer.
    ...(viaRaw ? { filters: {} } : {}),
    limit: 50,
    offset: 0,
  });
}

const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function asExpected(m: Awaited<ReturnType<typeof overview>>): Expected {
  return {
    visitors: m.visitors,
    sessions: m.sessions,
    pageviews: m.pageviews,
    bounce: m.bounceRatePercentage,
    avgDuration: m.avgDurationSeconds,
  };
}

test("all migrations applied and the rollup tables exist", { skip }, async () => {
  const tables = (await rows<{ name: string }>(`SELECT name FROM system.tables WHERE database = '${DB}'`)).map((r) => r.name);
  for (const t of ["events_raw", "web_vitals", "web_vitals_old", "pageview_rollups_daily", "session_engagement_daily", "daily_uniques"]) {
    assert.ok(tables.includes(t), `missing table ${t}; found ${tables.join(", ")}`);
  }
});

test("web_vitals collapses a redelivered event after migration 006", { skip }, async () => {
  const row = {
    event_id: "9d3b8c1e-5a47-4d9e-8b21-0c6f7a1d9e99",
    workspace_id: WS,
    site_id: SITE,
    timestamp: chTime(NOW),
    path: "/p",
    metric_name: "LCP",
    metric_value: 1800,
    rating: "good",
    navigation_type: "navigate",
  };
  const line = JSON.stringify(row);
  await ch(`INSERT INTO ${DB}.web_vitals FORMAT JSONEachRow`, line);
  await ch(`INSERT INTO ${DB}.web_vitals FORMAT JSONEachRow`, line); // the redelivery
  const [{ n }] = await rows<{ n: string }>(`SELECT count() AS n FROM ${DB}.web_vitals FINAL`);
  assert.equal(Number(n), 1);
});

for (const [label, n] of [["7-day", 7], ["30-day", 30]] as const) {
  test(`${label} rolling overview from rollups equals the raw query and the plain calculation`, { skip }, async () => {
    const from = days(n);
    const viaRollups = asExpected(await overview(from, NOW));
    const viaRaw = asExpected(await overview(from, NOW, true));
    const truth = expected(events, from, NOW);

    assert.deepEqual(viaRaw, truth, "the raw query disagrees with the plain calculation; the oracle is wrong");
    assert.deepEqual(viaRollups, truth);
    assert.ok(truth.pageviews > 0 && truth.sessions > 0);
  });
}

test("returning visitors are counted once across days, not once per day", { skip }, async () => {
  const from = days(30);
  const viaRollups = await overview(from, NOW);
  const sumOfDays = events
    .filter((e) => e.bot_status === "human")
    .reduce((acc, e) => acc.add(`${e.timestamp.slice(0, 10)}|${e.visitor_pseudonym}`), new Set<string>()).size;
  assert.ok(viaRollups.visitors < sumOfDays, `visitors ${viaRollups.visitors} should be below the per-day sum ${sumOfDays}`);
});

test("today's unfinished day is included", { skip }, async () => {
  // NOW is 12:00 on Oct 10; sessions on Oct 10 start at 08:00 and later.
  const todayOnly = expected(events, new Date("2026-10-10T00:00:00.000Z"), NOW);
  assert.ok(todayOnly.pageviews > 0, "test data should have events today");
  const with7 = await overview(days(7), NOW);
  const without = await overview(days(7), new Date("2026-10-09T23:59:59.000Z"));
  assert.equal(with7.pageviews - without.pageviews, todayOnly.pageviews);
});

test("the first partial day counts only events after `from`", { skip }, async () => {
  const from = new Date("2026-10-03T12:00:00.000Z");
  const truth = expected(events, from, NOW);
  assert.equal((await overview(from, NOW)).pageviews, truth.pageviews);
});

test("running the job again does not change any number", { skip }, async () => {
  const before_ = asExpected(await overview(days(30), NOW));
  await jobs.runDailyRollups({ now: NOW, settings });
  await jobs.runDailyRollups({ now: NOW, settings });
  assert.deepEqual(asExpected(await overview(days(30), NOW)), before_);
});

test("a wiped rollup table is repaired by the next run", { skip }, async () => {
  const truth = expected(events, days(30), NOW);
  for (const table of ["pageview_rollups_daily", "session_engagement_daily", "daily_uniques", "event_rollups_daily"]) {
    await ch(`TRUNCATE TABLE ${DB}.${table}`);
  }
  await jobs.runDailyRollups({ now: NOW, settings });
  assert.deepEqual(asExpected(await overview(days(30), NOW)), truth);
});

test("with the rollup tables empty the overview still answers correctly from raw events", { skip }, async () => {
  const truth = expected(events, days(7), NOW);
  for (const table of ["pageview_rollups_daily", "session_engagement_daily", "daily_uniques"]) {
    await ch(`TRUNCATE TABLE ${DB}.${table}`);
  }
  assert.deepEqual(asExpected(await overview(days(7), NOW)), truth);
  await jobs.runDailyRollups({ now: NOW, settings });
});
