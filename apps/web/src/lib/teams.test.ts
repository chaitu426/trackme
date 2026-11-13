import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "@trackme/contracts";
import { TeamNameSchema, parseGrantMap, teamSlug } from "./teams";

test("a team slug is a short, url-safe version of the name", () => {
  assert.equal(teamSlug("Marketing"), "marketing");
  assert.equal(teamSlug("QA & Release  Team!"), "qa-release-team");
  assert.equal(teamSlug("  --  "), "team");
  assert.equal(teamSlug("x".repeat(100)).length, 40);
});

test("team names are 2 to 48 characters once trimmed", () => {
  assert.equal(TeamNameSchema.safeParse("  QA ").success, true);
  assert.equal(TeamNameSchema.safeParse("a").success, false);
  assert.equal(TeamNameSchema.safeParse("x".repeat(49)).success, false);
});

test("a grant map becomes grants; none and null mean no access", () => {
  assert.deepEqual(parseGrantMap({ errors: "view", payments: "manage", funnels: "none", people: null }), [
    { feature: "errors", level: "view" },
    { feature: "payments", level: "manage" },
  ]);
  assert.deepEqual(parseGrantMap({}), []);
});

test("an unknown feature or level is refused, not silently dropped", () => {
  assert.throws(() => parseGrantMap({ billing: "view" }), (e) => e instanceof AppError && e.status === 400 && /not a feature/.test(e.detail));
  assert.throws(() => parseGrantMap({ errors: "owner" }), (e) => e instanceof AppError && /not an access level/.test(e.detail));
  assert.throws(() => parseGrantMap("errors"), AppError);
  assert.throws(() => parseGrantMap(null), AppError);
});
