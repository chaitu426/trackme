import assert from "node:assert/strict";
import { test } from "node:test";

import { bodyLimitFor, isPublicPath, MAX_API_BODY_BYTES } from "./middleware.js";

test("public pages remain reachable without a session", () => {
  assert.equal(isPublicPath("/"), true);
  assert.equal(isPublicPath("/login"), true);
  assert.equal(isPublicPath("/tracker.js"), true);
  assert.equal(isPublicPath("/share/abc"), true);
  // Billing providers post signed webhooks with no session.
  assert.equal(isPublicPath("/api/v1/webhooks/billing/demo"), true);
  assert.equal(isPublicPath("/api/v1/companies/x/billing"), false);
  assert.equal(isPublicPath("/legal/privacy"), true);
});

test("public API endpoints are explicitly allowlisted", () => {
  assert.equal(isPublicPath("/api/auth/login"), true);
  assert.equal(isPublicPath("/api/auth/signup"), true);
  assert.equal(isPublicPath("/api/auth/session"), true);
  assert.equal(isPublicPath("/api/auth/otp/send"), true);
  assert.equal(isPublicPath("/api/auth/otp/verify"), true);
  assert.equal(isPublicPath("/api/internal/metrics"), true);
  assert.equal(isPublicPath("/api/v1/invites/accept"), true);
  assert.equal(isPublicPath("/api/v1/invites/accept/preview"), true);
  assert.equal(isPublicPath("/api/v1/deploys"), true);
  assert.equal(isPublicPath("/api/v1/sourcemaps"), true);
});

test("non-public API routes are denied by default", () => {
  assert.equal(isPublicPath("/api/v1/metrics/overview"), false);
  assert.equal(isPublicPath("/api/v1/ask/runs"), false);
  assert.equal(isPublicPath("/api/v1/ask/runs/abc/events"), false);
  assert.equal(isPublicPath("/api/v1/workspaces"), false);
  assert.equal(isPublicPath("/api/v1/sites/abc/settings"), false);
  assert.equal(isPublicPath("/dashboard"), false);
});

test("only the source map upload may exceed the normal body limit", () => {
  assert.ok(bodyLimitFor("/api/v1/sourcemaps") > MAX_API_BODY_BYTES);
  assert.equal(bodyLimitFor("/api/v1/deploys"), MAX_API_BODY_BYTES);
  assert.equal(bodyLimitFor("/api/v1/sourcemaps/extra"), MAX_API_BODY_BYTES);
});

test("the brand files crawlers and link previews fetch are reachable without a session", () => {
  for (const p of ["/opengraph-image", "/apple-icon", "/manifest.webmanifest", "/sitemap.xml", "/robots.txt", "/icon.svg"]) {
    assert.equal(isPublicPath(p), true, p);
  }
});
