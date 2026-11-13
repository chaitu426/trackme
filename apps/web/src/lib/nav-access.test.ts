import { test } from "node:test";
import assert from "node:assert/strict";
import { featureForSitePath } from "@trackme/contracts";
import { NAV_SUITES, SITE_SETTINGS_ITEM } from "./nav";

test("every page in the sidebar is guarded by a feature, so a new page cannot be left open to everyone", () => {
  const paths = [...NAV_SUITES.flatMap((s) => s.items.map((i) => i.path)), SITE_SETTINGS_ITEM.path];
  const unguarded = paths.filter((p) => featureForSitePath(p) === null);
  assert.deepEqual(unguarded, [], `Add these to featureForSitePath: ${unguarded.join(", ")}`);
});
