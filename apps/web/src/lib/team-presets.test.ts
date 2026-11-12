import { test } from "node:test";
import assert from "node:assert/strict";
import { AccessLevelSchema, FEATURES } from "@trackme/contracts";
import { TEAM_PRESETS } from "./team-presets";
import { TeamNameSchema } from "./teams";

test("every preset has a valid name and only known features and levels", () => {
  for (const preset of TEAM_PRESETS) {
    assert.equal(TeamNameSchema.safeParse(preset.name).success, true, preset.name);
    assert.ok(Object.keys(preset.grants).length > 0, `${preset.name} grants nothing`);
    for (const [feature, level] of Object.entries(preset.grants)) {
      assert.ok((FEATURES as readonly string[]).includes(feature), `${preset.name}: unknown feature ${feature}`);
      assert.equal(AccessLevelSchema.safeParse(level).success, true);
    }
  }
});

test("preset names are unique, and no preset opens everything", () => {
  assert.equal(new Set(TEAM_PRESETS.map((p) => p.name)).size, TEAM_PRESETS.length);
  for (const preset of TEAM_PRESETS) assert.ok(Object.keys(preset.grants).length < FEATURES.length, `${preset.name} grants every feature`);
});

test("payments are only ever offered to the finance preset to manage", () => {
  const managers = TEAM_PRESETS.filter((p) => p.grants.payments === "manage").map((p) => p.name);
  assert.deepEqual(managers, ["Finance"]);
});
