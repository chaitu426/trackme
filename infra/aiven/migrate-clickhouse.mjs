// Applies infra/migrations/clickhouse/*.sql, in order, to a managed ClickHouse.
// The Docker setup does this through /docker-entrypoint-initdb.d; a managed service has
// no such hook, so applied files are recorded in <db>.schema_migrations instead.
//
//   node infra/aiven/migrate-clickhouse.mjs            apply pending migrations
//   node infra/aiven/migrate-clickhouse.mjs --dry-run  list what would run, touch nothing
import fs from "node:fs";
import path from "node:path";
import { loadEnv, need, repoRoot, requireFrom, splitStatements } from "./lib.mjs";

const dryRun = process.argv.includes("--dry-run");
const dir = path.join(repoRoot, "infra/migrations/clickhouse");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

if (dryRun) {
  for (const f of files) {
    const n = splitStatements(fs.readFileSync(path.join(dir, f), "utf8")).length;
    console.log(`would apply ${f} (${n} statements)`);
  }
  process.exit(0);
}

loadEnv();
const { createClient } = requireFrom("packages/analytics", "@clickhouse/client");
const db = process.env.CLICKHOUSE_DB ?? "growth_analytics";
const ca = process.env.CLICKHOUSE_CA_CERT_PATH;

const client = createClient({
  url: need("CLICKHOUSE_URL"),
  username: need("CLICKHOUSE_USER"),
  password: need("CLICKHOUSE_PASSWORD"),
  request_timeout: 120_000,
  ...(ca ? { tls: { ca_cert: fs.readFileSync(ca) } } : {}),
});

try {
  await client.command({ query: `CREATE DATABASE IF NOT EXISTS ${db}` });
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS ${db}.schema_migrations (
      name String, applied_at DateTime DEFAULT now()
    ) ENGINE = MergeTree ORDER BY name`,
  });
  const done = new Set(
    (await (await client.query({ query: `SELECT name FROM ${db}.schema_migrations`, format: "JSONEachRow" })).json()).map(
      (r) => r.name
    )
  );

  for (const f of files) {
    if (done.has(f)) {
      console.log(`skip   ${f}`);
      continue;
    }
    const statements = splitStatements(fs.readFileSync(path.join(dir, f), "utf8"));
    console.log(`apply  ${f} (${statements.length} statements)`);
    for (const [i, query] of statements.entries()) {
      try {
        await client.command({ query });
      } catch (err) {
        console.error(`\nFAILED ${f} statement ${i + 1}:\n${query.slice(0, 400)}\n\n${err.message}`);
        process.exitCode = 1;
        throw err;
      }
    }
    await client.insert({ table: `${db}.schema_migrations`, values: [{ name: f }], format: "JSONEachRow" });
  }
  console.log("ClickHouse migrations up to date.");
} catch {
  /* reported above */
} finally {
  await client.close();
}
