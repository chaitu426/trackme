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

import { navTargets, pageLabelFor } from "./nav";

test("the breadcrumb names every page, including the payments pages", () => {
  const label = (path: string) => pageLabelFor(`/acme${path}`, "acme");
  assert.equal(label("/overview"), "Overview");
  assert.equal(label("/settings"), "Organization & Team");
  assert.equal(label("/settings/sites"), "Websites");
  assert.equal(label("/sites/a.com/settings"), "Site Settings");
  assert.equal(label("/sites/a.com/payments"), "Payments Overview");
  assert.equal(label("/sites/a.com/payments/checkout"), "Checkout Funnel");
  assert.equal(label("/sites/a.com/payments/connect"), "Integrations");
  assert.equal(label("/sites/a.com/errors/123456"), "Error Tracking");
  assert.equal(label("/sites/a.com/releases/web%401.2.0"), "Release Impact");
  assert.equal(pageLabelFor("/other/overview", "acme"), undefined);
});

test("navigation targets point at the active site, or at the add-a-site page when there is none", () => {
  const withSite = navTargets("acme", "a.com");
  assert.equal(withSite.find((t) => t.label === "Realtime")?.href, "/acme/sites/a.com/realtime");
  assert.equal(withSite.find((t) => t.label === "Overview")?.href, "/acme/overview");
  const none = navTargets("acme", null);
  assert.equal(none.find((t) => t.label === "Realtime")?.href, "/acme/settings/sites");
  assert.equal(new Set(withSite.map((t) => t.id)).size, withSite.length);
});
