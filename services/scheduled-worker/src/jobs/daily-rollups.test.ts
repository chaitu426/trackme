import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENGAGEMENT_SQL,
  EVENTS_SQL,
  PAGEVIEWS_SQL,
  UNIQUES_SQL,
  runDailyRollups,
  type RollupClient,
  type RollupSettings,
} from "./daily-rollups.js";

const settings: RollupSettings = { lookbackDays: 2, backfillDays: 65, maxDaysPerRun: 14 };
const now = new Date("2026-10-10T09:30:00.000Z");

type Command = { query: string; day: unknown };

/** A fake ClickHouse that reports the newest day per rollup table. */
function fakeClient(lastDates: Record<string, string | null>, earliest: string | null = "2026-09-01") {
  const commands: Command[] = [];
  const client: RollupClient = {
    async command({ query, query_params }) {
      commands.push({ query, day: query_params?.day });
    },
    async query({ query }) {
      const table = /FROM (\w+)$/.exec(query.trim())?.[1] ?? "";
      if (query.includes("events_raw")) {
        return { json: async <T,>() => [{ first: earliest ?? "1970-01-01", n: earliest ? 5 : 0 }] as T[] };
      }
      const last = lastDates[table] ?? null;
      return { json: async <T,>() => [{ last: last ?? "1970-01-01", n: last ? 5 : 0 }] as T[] };
    },
  };
  return { client, commands };
}

const daysFor = (commands: Command[], sql: string) =>
  commands.filter((c) => c.query === sql).map((c) => c.day);

test("every statement uses only the {day:Date} placeholder", () => {
  for (const sql of [PAGEVIEWS_SQL, EVENTS_SQL, ENGAGEMENT_SQL, UNIQUES_SQL]) {
    const names = new Set([...sql.matchAll(/\{(\w+):/g)].map((m) => m[1]));
    assert.deepEqual([...names], ["day"]);
  }
});

test("bots never reach a rollup", () => {
  for (const sql of [PAGEVIEWS_SQL, EVENTS_SQL, ENGAGEMENT_SQL, UNIQUES_SQL]) {
    assert.match(sql, /bot_status = 'human'/);
  }
});

test("a healthy run recomputes the lookback window and today for every table", async () => {
  const last = "2026-10-10";
  const { client, commands } = fakeClient({
    pageview_rollups_daily: last,
    session_engagement_daily: last,
    daily_uniques: last,
  });
  await runDailyRollups({ client, now, settings });

  const expected = ["2026-10-08", "2026-10-09", "2026-10-10"];
  assert.deepEqual(daysFor(commands, PAGEVIEWS_SQL), expected);
  assert.deepEqual(daysFor(commands, EVENTS_SQL), expected);
  assert.deepEqual(daysFor(commands, ENGAGEMENT_SQL), expected);
  assert.deepEqual(daysFor(commands, UNIQUES_SQL), expected);
});

test("after downtime every table resumes from where it ended", async () => {
  const { client, commands } = fakeClient({
    pageview_rollups_daily: "2026-10-05",
    session_engagement_daily: "2026-10-05",
    daily_uniques: "2026-10-05",
  });
  await runDailyRollups({ client, now, settings });

  const days = daysFor(commands, PAGEVIEWS_SQL);
  assert.equal(days[0], "2026-10-04");
  assert.equal(days.at(-1), "2026-10-10");
});

test("a new table is seeded from the first day with events while the others stay incremental", async () => {
  const { client, commands } = fakeClient(
    { pageview_rollups_daily: "2026-10-10", session_engagement_daily: "2026-10-10", daily_uniques: null },
    "2026-10-02"
  );
  await runDailyRollups({ client, now, settings });

  assert.equal(daysFor(commands, PAGEVIEWS_SQL).length, 3);
  const uniques = daysFor(commands, UNIQUES_SQL);
  assert.equal(uniques[0], "2026-10-02");
  assert.equal(uniques.length, 9);
});

test("a backlog is limited per run", async () => {
  const { client, commands } = fakeClient({}, "2026-08-01");
  await runDailyRollups({ client, now, settings: { ...settings, maxDaysPerRun: 5 } });
  assert.equal(daysFor(commands, UNIQUES_SQL).length, 5);
});

test("a database error stops the run instead of being swallowed", async () => {
  const { client } = fakeClient({ pageview_rollups_daily: "2026-10-10" });
  client.command = async () => {
    throw new Error("clickhouse unavailable");
  };
  await assert.rejects(runDailyRollups({ client, now, settings }), /clickhouse unavailable/);
});
