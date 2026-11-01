/**
 * Runs the same synthetic traffic through the legacy tables (v1) and events_ingest ->
 * events_v2 -> aggregates (v2) on a real ClickHouse, then checks every dashboard read
 * returns the same answer from both.
 *
 *   CLICKHOUSE_TEST_URL=https://host:port CLICKHOUSE_TEST_USER=avnadmin \
 *   CLICKHOUSE_TEST_PASSWORD=... node --import tsx --test src/read-v2.integration.test.ts
 *
 * It creates a scratch database, applies every migration to it, and drops it afterwards.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const URL_ = process.env.CLICKHOUSE_TEST_URL;
const USER = process.env.CLICKHOUSE_TEST_USER ?? "default";
const PASSWORD = process.env.CLICKHOUSE_TEST_PASSWORD ?? "";
const skip = !URL_ ? "set CLICKHOUSE_TEST_URL to run against a real ClickHouse" : false;

const DB = `it_${randomBytes(4).toString("hex")}`;
const WS = "0b9f6a64-0d1f-4f3a-9c55-2d4f5c0f8a11";
const SITE = "a1c2e3f4-1111-4222-8333-444455556666";
const NOW = new Date("2026-10-10T12:00:00.000Z");
const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../infra/migrations/clickhouse");

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

function statements(file: string): string[] {
  const sql = readFileSync(path.join(MIGRATIONS, file), "utf8")
    .replaceAll("growth_analytics", DB)
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return sql.split(";").map((s) => s.trim()).filter(Boolean);
}

// ---- synthetic traffic ---------------------------------------------------------

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;

const PATHS = ["/", "/pricing", "/docs", "/blog"];
const COUNTRIES = ["US", "DE", "IN", ""]; // "" = unknown
const DEVICES = ["desktop", "mobile"];
const REFERRERS = ["", "https://www.google.com/search?q=a", "https://news.ycombinator.com/item?id=1"];

interface Synthetic {
  id: string;
  ts: Date;
  type: "pageview" | "custom" | "web_vital";
  name: string;
  session: string;
  visitor: string;
  path: string;
  country: string;
  device: string;
  referrer: string;
  bot: boolean;
  vital?: { name: string; value: number; rating: string };
}

function generate(): Synthetic[] {
  const out: Synthetic[] = [];
  let n = 0;
  for (let v = 0; v < 40; v++) {
    const visitor = `visitor-${v}`;
    const country = pick(COUNTRIES);
    const device = pick(DEVICES);
    for (let s = 0; s < 1 + Math.floor(rnd() * 3); s++) {
      const dayOffset = 0.2 + rnd() * 8.6; // days before NOW; spans the head, tail and whole days
      // every fifth session starts just before midnight so it crosses a day boundary
      const base = new Date(NOW.getTime() - dayOffset * 86_400_000);
      if (s === 0 && v % 5 === 0) base.setUTCHours(23, 50, 0, 0);
      const session = `session-${v}-${s}`;
      const bot = rnd() < 0.08;
      const referrer = pick(REFERRERS);
      const length = 1 + Math.floor(rnd() * 5);
      for (let i = 0; i < length; i++) {
        const ts = new Date(base.getTime() + i * 4 * 60_000);
        if (ts > NOW) continue;
        const roll = rnd();
        const type = roll < 0.12 ? "custom" : roll < 0.2 ? "web_vital" : "pageview";
        out.push({
          id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
          ts, type, name: type === "custom" ? "signup" : type, session, visitor,
          path: pick(PATHS), country, device, referrer: i === 0 ? referrer : "", bot,
          ...(type === "web_vital"
            ? { vital: { name: pick(["LCP", "INP"]), value: 500 + Math.floor(rnd() * 3000), rating: pick(["good", "poor"]) } }
            : {}),
        });
      }
    }
  }
  return out;
}

const dt = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "");

function legacyRow(e: Synthetic, site = SITE) {
  return {
    event_id: e.id, schema_version: 1, workspace_id: WS, site_id: site, site_key: "k",
    timestamp: dt(e.ts), received_at: dt(e.ts), type: e.type, event_name: e.name,
    session_id: e.session, visitor_pseudonym: e.visitor, url: `https://x.com${e.path}`, path: e.path,
    title: "", referrer: e.referrer, campaign_source: "", campaign_medium: "", campaign_name: "",
    campaign_term: "", campaign_content: "", country: e.country || "  ", city: "", browser: "chrome", os: "mac",
    device: e.device, bot_status: e.bot ? "bot" : "human", properties_json: "{}",
  };
}

function ingestRow(e: Synthetic) {
  const { country, ...rest } = legacyRow(e);
  return {
    ...rest, schema_version: 2, country: country.trim(),
    vital_name: e.vital?.name ?? "", vital_value: e.vital?.value ?? 0,
    vital_rating: e.vital?.rating ?? "", vital_nav_type: e.vital ? "navigate" : "",
  };
}

const jsonRows = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n");

// ---- the comparison ------------------------------------------------------------

type Api = typeof import("./index.js");
let api: Api;
let config: { env: { ANALYTICS_READ: string } };

before(async () => {
  if (skip) return;
  process.env.CLICKHOUSE_URL = URL_;
  process.env.CLICKHOUSE_USER = USER;
  process.env.CLICKHOUSE_PASSWORD = PASSWORD;
  process.env.CLICKHOUSE_DB = DB;
  process.env.CLICKHOUSE_DASHBOARD_USER = ""; // the scratch database is only granted to the test user

  await ch(`CREATE DATABASE ${DB}`);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of statements(file)) await ch(statement);
  }

  const events = generate();
  await ch(`INSERT INTO ${DB}.events_raw FORMAT JSONEachRow`, jsonRows(events.map((e) => legacyRow(e))));
  await ch(
    `INSERT INTO ${DB}.web_vitals FORMAT JSONEachRow`,
    jsonRows(
      events.filter((e) => e.vital).map((e) => ({
        event_id: e.id, workspace_id: WS, site_id: SITE, timestamp: dt(e.ts), path: e.path,
        metric_name: e.vital!.name, metric_value: e.vital!.value, rating: e.vital!.rating, navigation_type: "navigate",
      }))
    )
  );
  await ch(`INSERT INTO ${DB}.events_ingest FORMAT JSONEachRow`, jsonRows(events.map(ingestRow)));

  api = await import("./index.js");
  config = (await import("@trackme/config")) as unknown as typeof config;
});

after(async () => {
  if (skip) return;
  await ch(`DROP DATABASE IF EXISTS ${DB} SYNC`);
});

async function both<T>(run: () => Promise<T>): Promise<{ v1: T; v2: T }> {
  config.env.ANALYTICS_READ = "v1";
  const v1 = await run();
  config.env.ANALYTICS_READ = "v2";
  const v2 = await run();
  return { v1, v2 };
}

const range = (hours: number, granularity: "hour" | "day" = "day") => ({
  from: new Date(NOW.getTime() - hours * 3_600_000).toISOString(),
  to: NOW.toISOString(),
  granularity,
});
const request = (hours: number, filters?: Record<string, string>, granularity: "hour" | "day" = "day") =>
  ({ workspaceId: WS, siteId: SITE, dateRange: range(hours, granularity), ...(filters ? { filters } : {}) }) as never;

const ranges: Array<[string, number, Record<string, string> | undefined]> = [
  ["24h", 24, undefined],
  ["7d", 168, undefined],
  ["7d filtered by country", 168, { country: "US" }],
];

for (const [label, hours, filters] of ranges) {
  test(`overview matches between v1 and v2: ${label}`, { skip }, async () => {
    const { v1, v2 } = await both(() => api.getOverviewMetrics(request(hours, filters)));
    const strip = ({ siteId: _s, dateRange: _d, ...rest }: typeof v1) => rest;
    assert.deepEqual(api.diffResults(strip(v1), strip(v2), 0.03), [], `${JSON.stringify(v1)} vs ${JSON.stringify(v2)}`);
    assert.ok(v1.pageviews > 0, "the fixture must produce traffic in range");
  });

  for (const dimension of ["path", "country", "device"] as const) {
    test(`breakdown ${dimension} matches between v1 and v2: ${label}`, { skip }, async () => {
      const { v1, v2 } = await both(() => api.getBreakdown(request(hours, filters), dimension));
      const key = (r: typeof v1) => r.items.map((i) => ({ n: i.name.trim() || "(direct / none)", v: i.visitors, p: i.pageviews }))
        .sort((a, b) => a.n.localeCompare(b.n));
      assert.deepEqual(api.diffResults(key(v1), key(v2), 0.03), []);
    });
  }
}

test("time series, custom events and web vitals match between v1 and v2", { skip }, async () => {
  const series = await both(() => api.getTimeSeries(request(168)));
  assert.deepEqual(api.diffResults(series.v1, series.v2, 0.03), []);

  const events = await both(() => api.getCustomEventsSummary(request(168)));
  assert.deepEqual(api.diffResults(events.v1, events.v2, 0.03), []);

  const vitals = await both(() => api.getWebVitalsSummary(request(168)));
  // v1 also counted bot traffic, so allow for it; shapes and metric names must agree.
  assert.deepEqual(vitals.v1.map((v) => v.metric), vitals.v2.map((v) => v.metric));
  assert.ok(vitals.v2.every((v) => v.totalSamples > 0));
});

test("event-level reads agree: recent events, first-event status, journeys", { skip }, async () => {
  const first = await both(() => api.getFirstEventStatus(WS, SITE));
  assert.equal(first.v1.totalEvents, first.v2.totalEvents);

  const journeys = await both(() => api.getTopJourneys(request(168)));
  assert.deepEqual(api.diffResults(journeys.v1, journeys.v2, 0.03), []);

  const recent = await both(() => api.getRecentEvents(WS, SITE, 10));
  assert.deepEqual(recent.v1.map((e) => e.eventId), recent.v2.map((e) => e.eventId));
});

test("a 7-day overview reads far fewer rows from v2 than a raw scan", { skip }, async () => {
  // The aggregate tables hold one row per site-day, whatever the traffic.
  const rows = Number((await ch(`SELECT count() FROM ${DB}.site_daily_agg`)).trim());
  const raw = Number((await ch(`SELECT count() FROM ${DB}.events_v2`)).trim());
  assert.ok(rows < raw / 5, `site_daily_agg has ${rows} rows vs ${raw} raw events`);
});

const SITE_B = "b2d3f4a5-2222-4333-8444-555566667777";

test("backfill copies legacy history into v2 so both schemas agree", { skip }, async () => {
  // Legacy-only history for a second site: nothing was ever written to events_ingest for it.
  const history = generate().map((e) => ({ ...e, id: e.id.replace("00000000-0000-4000", "00000001-0000-4000") }));
  await ch(`INSERT INTO ${DB}.events_raw FORMAT JSONEachRow`, jsonRows(history.map((e) => legacyRow(e, SITE_B))));
  await ch(
    `INSERT INTO ${DB}.web_vitals FORMAT JSONEachRow`,
    jsonRows(
      history.filter((e) => e.vital).map((e) => ({
        event_id: e.id, workspace_id: WS, site_id: SITE_B, timestamp: dt(e.ts), path: e.path,
        metric_name: e.vital!.name, metric_value: e.vital!.value, rating: e.vital!.rating, navigation_type: "navigate",
      }))
    )
  );

  const { createClient } = await import("@clickhouse/client");
  const client = createClient({ url: URL_!, username: USER, password: PASSWORD, database: DB });
  const options = { from: "2026-09-25", to: "2026-10-11", t0: "2026-10-11T00:00:00Z", siteId: SITE_B };

  const first = await api.backfillEventsV2(client, options);
  assert.ok(first.some((o) => o.action === "copied"));
  const again = await api.backfillEventsV2(client, options);
  assert.ok(again.every((o) => o.action === "skipped"), "a second run must copy nothing");

  config.env.ANALYTICS_READ = "v1";
  const legacy = await api.getOverviewMetrics({ ...(request(168) as object), siteId: SITE_B } as never);
  config.env.ANALYTICS_READ = "v2";
  const v2 = await api.getOverviewMetrics({ ...(request(168) as object), siteId: SITE_B } as never);
  const strip = ({ siteId: _s, dateRange: _d, ...rest }: typeof legacy) => rest;
  assert.deepEqual(api.diffResults(strip(legacy), strip(v2), 0.03), []);
  assert.ok(v2.pageviews > 0);
  await client.close();
});
