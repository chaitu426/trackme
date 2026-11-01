import assert from "node:assert/strict";
import test from "node:test";
import {
  isIssuedBeforeValidAfter,
  issuedAtSeconds,
  parseValidAfterUnix,
  sessionsValidAfterKey,
} from "./session-policy";

test("sessionsValidAfterKey is scoped to the user", () => {
  assert.equal(sessionsValidAfterKey("user-1"), "user:sva:user-1");
});

test("missing iat is treated as epoch so revoke-all still rejects legacy tokens", () => {
  assert.equal(issuedAtSeconds(undefined), 0);
  assert.equal(isIssuedBeforeValidAfter(undefined, 1_700_000_000), true);
  assert.equal(isIssuedBeforeValidAfter(1_700_000_001, 1_700_000_000), false);
  assert.equal(isIssuedBeforeValidAfter(0, 0), false);
});

test("parseValidAfterUnix ignores junk", () => {
  assert.equal(parseValidAfterUnix("1700000000"), 1_700_000_000);
  assert.equal(parseValidAfterUnix(null), null);
  assert.equal(parseValidAfterUnix("nope"), null);
});
