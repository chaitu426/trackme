import assert from "node:assert/strict";
import test from "node:test";

import { toWebVitalMetric } from "./vitals";

test("rounds millisecond metrics to whole numbers", () => {
  const m = toWebVitalMetric({ name: "LCP", value: 2481.6, rating: "good", navigationType: "navigate" });
  assert.deepEqual(m, { name: "LCP", value: 2482, rating: "good", navigationType: "navigate" });
});

test("keeps three decimals on CLS", () => {
  const m = toWebVitalMetric({ name: "CLS", value: 0.123456, rating: "needs-improvement", navigationType: "reload" });
  assert.equal(m.value, 0.123);
  assert.equal(m.rating, "needs-improvement");
});

test("omits the navigation type when the library gives none", () => {
  const m = toWebVitalMetric({ name: "TTFB", value: 120, rating: "good" } as never);
  assert.equal("navigationType" in m, false);
});
