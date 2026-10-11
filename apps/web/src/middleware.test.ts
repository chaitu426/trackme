import assert from "node:assert/strict";
import { test } from "node:test";

import { isPublicPath } from "./middleware.js";

test("public pages remain reachable without a session", () => {
  assert.equal(isPublicPath("/"), true);
  assert.equal(isPublicPath("/login"), true);
  assert.equal(isPublicPath("/tracker.js"), true);
  assert.equal(isPublicPath("/share/abc"), true);
  assert.equal(isPublicPath("/legal/privacy"), true);
});

test("public API endpoints are explicitly allowlisted", () => {
  assert.equal(isPublicPath("/api/auth/login"), true);
  assert.equal(isPublicPath("/api/auth/signup"), true);
  assert.equal(isPublicPath("/api/auth/session"), true);
  assert.equal(isPublicPath("/api/v1/invites/accept"), true);
  assert.equal(isPublicPath("/api/v1/invites/accept/preview"), true);
});

test("non-public API routes are denied by default", () => {
  assert.equal(isPublicPath("/api/v1/metrics/overview"), false);
  assert.equal(isPublicPath("/api/v1/workspaces"), false);
  assert.equal(isPublicPath("/api/v1/sites/abc/settings"), false);
  assert.equal(isPublicPath("/dashboard"), false);
});
