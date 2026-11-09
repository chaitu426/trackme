import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV_SUITES } from "./nav";

const labels = NAV_SUITES.flatMap((suite) => suite.items.map((item) => item.label));

test("every page that exists is in the sidebar, with nothing hidden", () => {
  for (const label of [
    "Overview", "Realtime", "User Profiles", "User Journeys", "Funnels", "Acquisition", "Audience Geography",
    "Goals & Events", "Retention & Cohorts", "Page Performance", "Web Vitals", "Error Tracking", "Release Impact",
  ]) {
    assert.ok(labels.includes(label), `${label} must be in the sidebar`);
  }
});

test("no suite is empty and no page is listed twice", () => {
  assert.ok(NAV_SUITES.every((suite) => suite.items.length > 0));
  assert.equal(new Set(labels).size, labels.length);
});

test("the nav has no feature-flag mechanism", () => {
  for (const suite of NAV_SUITES) for (const item of suite.items) assert.ok(!("flag" in item));
});
