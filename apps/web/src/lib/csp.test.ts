import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCsp, cspHeader, cspMode, newNonce } from "./csp";

test("scripts need the request's nonce, and nothing can frame the page or inject a base tag", () => {
  const csp = buildCsp("abc123");
  assert.match(csp, /script-src 'self' 'nonce-abc123' 'strict-dynamic'/);
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp));
  assert.ok(!/script-src[^;]*'unsafe-eval'/.test(csp));
  for (const d of ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"]) assert.ok(csp.includes(d), d);
});

test("report-only is the default rollout mode, enforce must be asked for, off disables it", () => {
  assert.equal(cspMode(undefined), "report-only");
  assert.equal(cspMode("anything-else"), "report-only");
  assert.equal(cspMode("enforce"), "enforce");
  assert.equal(cspMode("off"), "off");
  assert.equal(cspHeader("report-only", "n")!.name, "Content-Security-Policy-Report-Only");
  assert.equal(cspHeader("enforce", "n")!.name, "Content-Security-Policy");
  assert.equal(cspHeader("off", "n"), null);
});

test("every request gets a different, unguessable nonce", () => {
  const a = newNonce();
  const b = newNonce();
  assert.notEqual(a, b);
  assert.ok(a.length >= 22);
});
