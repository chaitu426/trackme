import { test } from "node:test";
import assert from "node:assert/strict";
import { hasScope } from "./api-keys.js";

test("a deploy key can report deploys and nothing else", () => {
  assert.equal(hasScope(["write:deploys"], "write:deploys"), true);
  assert.equal(hasScope(["write:deploys"], "read:analytics"), false);
  assert.equal(hasScope(["write:deploys"], "admin:workspace"), false);
});

test("a reporting key cannot report deploys; an admin key can", () => {
  assert.equal(hasScope(["read:analytics"], "write:deploys"), false);
  assert.equal(hasScope(["admin:workspace"], "write:deploys"), true);
});
