import { test } from "node:test";
import assert from "node:assert/strict";
import { ERASURE_SQL, eraseVisitor } from "./erasure.js";

const target = { workspaceId: "11111111-1111-1111-1111-111111111111", siteId: "22222222-2222-2222-2222-222222222222", identifier: "ada@example.com" };

type Call = { kind: "query" | "command"; query: string; params: Record<string, unknown> };

function fake(found: { visitors: string[]; hashes: string[] }) {
  const calls: Call[] = [];
  const client = {
    async query({ query, query_params }: { query: string; query_params: Record<string, unknown> }) {
      calls.push({ kind: "query", query, params: query_params });
      const rows = query === ERASURE_SQL.findVisitors ? found.visitors.map((v) => ({ v })) : query === ERASURE_SQL.findHashes ? found.hashes.map((h) => ({ h })) : [{ n: "7" }];
      return { json: async () => rows };
    },
    async command({ query, query_params }: { query: string; query_params: Record<string, unknown> }) {
      calls.push({ kind: "command", query, params: query_params });
    },
  };
  return { client: client as never, calls };
}

test("deletes web_vitals, then events_v2, then events_raw, and reports what it removed", async () => {
  const { client, calls } = fake({ visitors: ["v1", "v2"], hashes: ["123"] });
  const result = await eraseVisitor(target, { dryRun: false }, client);

  const deletes = calls.filter((c) => c.kind === "command").map((c) => c.query);
  assert.deepEqual(deletes, [
    ERASURE_SQL.delete.site_profiles_agg,
    ERASURE_SQL.delete.web_vitals,
    ERASURE_SQL.delete.events_v2,
    ERASURE_SQL.delete.events_raw,
  ]);
  assert.deepEqual(result, { visitors: 2, rows: { site_profiles_agg: 7, web_vitals: 7, events_v2: 7, events_raw: 7 }, dryRun: false });
});

test("without confirmation (dry run) nothing is deleted", async () => {
  const { client, calls } = fake({ visitors: ["v1"], hashes: [] });
  const result = await eraseVisitor(target, { dryRun: true }, client);
  assert.equal(calls.filter((c) => c.kind === "command").length, 0);
  assert.equal(result.rows.events_raw, 7);
  assert.equal(result.dryRun, true);
});

test("a person with no events still has their profile removed, and no event table is touched", async () => {
  const { client, calls } = fake({ visitors: [], hashes: [] });
  const result = await eraseVisitor(target, { dryRun: false }, client);
  assert.equal(result.visitors, 0);
  assert.deepEqual(
    calls.filter((c) => c.kind === "command").map((c) => c.query),
    [ERASURE_SQL.delete.site_profiles_agg]
  );
  assert.equal(result.rows.events_raw, 0);
});

test("every statement is scoped to one workspace and one site, with the ids bound as parameters", async () => {
  const { client, calls } = fake({ visitors: ["v1"], hashes: ["9"] });
  await eraseVisitor(target, { dryRun: false }, client);
  for (const c of calls) {
    assert.match(c.query, /workspace_id = \{workspaceId:UUID\} AND site_id = \{siteId:UUID\}/);
    assert.equal(c.params.workspaceId, target.workspaceId);
    assert.equal(c.params.siteId, target.siteId);
  }
});

test("the identifier and the ids found are only ever bound parameters, never part of the SQL text", async () => {
  const { client, calls } = fake({ visitors: ["visitor-secret-1"], hashes: ["424242"] });
  await eraseVisitor({ ...target, identifier: "x' OR 1=1 --" }, { dryRun: false }, client);
  for (const c of calls) {
    assert.ok(!c.query.includes("OR 1=1"));
    assert.ok(!c.query.includes("visitor-secret-1"));
    assert.ok(!c.query.includes("424242"));
  }
  assert.deepEqual(calls.at(-1)!.params.visitors, ["visitor-secret-1"]);
});

test("each delete statement carries its own tenant predicate (not just the lookups)", () => {
  for (const [table, sql] of Object.entries(ERASURE_SQL.delete)) {
    assert.match(sql, /^DELETE FROM /, table);
    assert.match(sql, /workspace_id = \{workspaceId:UUID\} AND site_id = \{siteId:UUID\}/, table);
  }
});
