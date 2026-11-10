import { test } from "node:test";
import assert from "node:assert/strict";
import { runTemplate, effectiveMaxRows, TemplateRefusedError } from "./runner.js";
import { resolveRange } from "./scope.js";
import { MAX_SCOPE_ROWS } from "./scope.js";

const deps = (sources: Partial<Record<string, boolean>> = {}) => ({
  tenant: { workspaceId: "11111111-1111-1111-1111-111111111111", siteId: "22222222-2222-2222-2222-222222222222" },
  sources: { traffic: false, errors: false, payments: false, releases: false, people: false, ...sources } as never,
  maxRows: 100,
});
const range = resolveRange("30d", new Date("2026-11-10T00:00:00Z"));

test("effectiveMaxRows never exceeds the server cap", () => {
  assert.equal(effectiveMaxRows(50_000), MAX_SCOPE_ROWS);
  assert.equal(effectiveMaxRows(0), MAX_SCOPE_ROWS); // 0/unset means "use the cap"
  assert.equal(effectiveMaxRows(250), 250);
});

test("an unknown template is refused by name", async () => {
  await assert.rejects(runTemplate("nope", {}, range, deps(), 1), TemplateRefusedError);
});

test("a template whose source is off is refused", async () => {
  await assert.rejects(runTemplate("traffic_overview", {}, range, deps({ traffic: false }), 1), /traffic data, which is switched off/);
});

test("bad params are refused with the field named", async () => {
  await assert.rejects(runTemplate("traffic_breakdown", { dimension: "planet" }, range, deps({ traffic: true }), 1), /dimension/);
});
