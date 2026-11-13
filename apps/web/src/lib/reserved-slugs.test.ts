import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RESERVED_SLUGS, isReservedSlug } from "./reserved-slugs";

test("a workspace cannot take the name of a top-level route", () => {
  for (const slug of ["login", "signup", "billing", "api", "Onboarding"]) assert.equal(isReservedSlug(slug), true);
  assert.equal(isReservedSlug("acme"), false);
});

test("every public folder directly under src/app is reserved", () => {
  const app = fileURLToPath(new URL("../app", import.meta.url));
  // Route groups, private folders and dynamic segments are not part of a URL's first segment.
  const routes = readdirSync(app).filter((name) => statSync(`${app}/${name}`).isDirectory() && !/^[(_\[]/.test(name));
  const missing = routes.filter((name) => !RESERVED_SLUGS.has(name));
  assert.deepEqual(missing, [], `Add these to RESERVED_SLUGS: ${missing.join(", ")}`);
});
