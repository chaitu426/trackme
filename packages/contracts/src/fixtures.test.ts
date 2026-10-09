import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TrackerEventSchema } from "./events.js";

type Case = { name: string; valid: boolean; event: unknown };

const fixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/tracker-events.json", import.meta.url)), "utf8")
) as { cases: Case[] };

// The Go edge runs the same file in internal/validate. If one side changes its
// rules without the other, one of the two suites fails.
for (const c of fixtures.cases) {
  test(`TrackerEventSchema: ${c.name}`, () => {
    assert.equal(TrackerEventSchema.safeParse(c.event).success, c.valid);
  });
}
