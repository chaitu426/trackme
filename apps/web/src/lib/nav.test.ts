import { test } from "node:test";
import assert from "node:assert/strict";
import { Gauge } from "lucide-react";
import { NAV_SUITES, parseFeatureFlags, visibleSuites, type NavSuite } from "./nav";

const icon = Gauge;
const suites: NavSuite[] = [
  { id: "a", title: "A", items: [{ path: "x", label: "X", icon }, { path: "y", label: "Y", icon, flag: "errors" }] },
  { id: "b", title: "B", items: [{ path: "z", label: "Z", icon, flag: "retention" }] },
];

test("parseFeatureFlags trims, lower-cases and ignores blanks", () => {
  assert.deepEqual([...parseFeatureFlags(" Errors, ,retention ")], ["errors", "retention"]);
  assert.equal(parseFeatureFlags(undefined).size, 0);
});

test("flagged items stay hidden until their flag is on", () => {
  const off = visibleSuites(suites, new Set());
  assert.deepEqual(off.map((s) => s.items.map((i) => i.label)), [["X"]]);
  const on = visibleSuites(suites, new Set(["errors", "retention"]));
  assert.deepEqual(on.map((s) => s.items.map((i) => i.label)), [["X", "Y"], ["Z"]]);
});

test("every shipped page is reachable with no flags on", () => {
  const shown = visibleSuites(NAV_SUITES, new Set()).flatMap((s) => s.items.map((i) => i.label));
  for (const label of ["Overview", "Realtime", "User Profiles", "User Journeys", "Funnels", "Acquisition",
    "Audience Geography", "Goals & Events", "Page Performance", "Web Vitals"]) {
    assert.ok(shown.includes(label), `${label} must stay in the sidebar`);
  }
});
