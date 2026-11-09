import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseCurrency, fillDays, formatMoney, minorDivisor, paymentRanges, pctChange } from "./payments-view";

test("divisor follows the currency", () => {
  assert.equal(minorDivisor("USD"), 100);
  assert.equal(minorDivisor("JPY"), 1);
  assert.equal(minorDivisor("KWD"), 1000);
  assert.equal(minorDivisor("NOPE"), 100);
});

test("money is formatted from minor units", () => {
  assert.equal(formatMoney(239900, "INR"), "₹2,399.00");
  assert.equal(formatMoney(1500, "JPY"), "¥1,500");
  assert.equal(formatMoney(0, "USD"), "$0.00");
});

test("ranges are inclusive and the previous one is the same length, directly before", () => {
  const r = paymentRanges("7d", new Date("2026-11-09T12:00:00Z"));
  assert.deepEqual(r.current, { from: "2026-11-03", to: "2026-11-09" });
  assert.deepEqual(r.previous, { from: "2026-10-27", to: "2026-11-02" });
});

test("change needs a baseline", () => {
  assert.equal(pctChange(150, 100), 50);
  assert.equal(pctChange(5, 0), null);
});

test("currency choice falls back to the biggest", () => {
  const c = [{ currency: "USD", revenueMinor: 5 }, { currency: "INR", revenueMinor: 90 }] as never;
  assert.equal(chooseCurrency(c, "usd")?.currency, "USD");
  assert.equal(chooseCurrency(c, "EUR")?.currency, "INR");
  assert.equal(chooseCurrency([], undefined), null);
});

test("days with no payments are filled with zeros", () => {
  const out = fillDays([{ day: "2026-11-02", currency: "USD", revenueMinor: 10, paid: 1, attempts: 1 }], "USD", "2026-11-01", "2026-11-03");
  assert.deepEqual(out.map((d) => d.revenueMinor), [0, 10, 0]);
});
