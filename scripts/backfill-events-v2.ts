/**
 * Copies legacy events (events_raw + web_vitals) into events_ingest so events_v2 and every
 * aggregate table have full history. Run after WORKER_WRITE_V2=shadow has been on for a while.
 *
 *   pnpm exec tsx scripts/backfill-events-v2.ts --t0 2026-10-13T00:00:00Z [--from 2026-08-01] [--to 2026-10-12] [--site <uuid>] [--dry-run]
 *
 * --t0 is the moment shadow writes started (the first received_at that is already in v2).
 * Without --from, the earliest legacy day is used; without --to, the day of --t0.
 */
import { backfillEventsV2, getClickHouseClient } from "@trackme/analytics";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const t0 = arg("t0");
  if (!t0) {
    console.error("--t0 <ISO time> is required: when WORKER_WRITE_V2=shadow was switched on.");
    process.exit(1);
  }
  const client = getClickHouseClient();

  let from = arg("from");
  if (!from) {
    const rs = await client.query({
      query: "SELECT toString(min(toDate(timestamp))) AS d FROM events_raw",
      format: "JSONEachRow",
    });
    from = (await rs.json<{ d: string }>())[0]?.d;
    if (!from || from === "1970-01-01") {
      console.log("events_raw is empty; nothing to copy.");
      await client.close();
      return;
    }
  }
  const to = arg("to") ?? t0.slice(0, 10);
  const siteId = arg("site");
  const dryRun = process.argv.includes("--dry-run");

  console.log(`Backfill ${from}..${to} (received before ${t0})${siteId ? ` for site ${siteId}` : ""}${dryRun ? " [dry run]" : ""}`);
  const outcomes = await backfillEventsV2(
    client,
    { from, to, t0, ...(siteId ? { siteId } : {}) },
    {
      dryRun,
      onDay: (o) => console.log(`  ${o.day}  ${o.action}  legacy=${o.legacy}${"v2" in o ? ` v2=${o.v2}` : ""}`),
    }
  );
  const copied = outcomes.filter((o) => o.action === "copied").length;
  console.log(`Done: ${copied} day(s) copied, ${outcomes.length - copied} skipped or planned.`);
  await client.close();
}

main().catch((error) => {
  console.error("Backfill failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
