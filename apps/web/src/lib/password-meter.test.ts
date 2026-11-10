import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPassword, strengthLabel } from "./password-meter";

test("an empty password has no strength", () => {
  const r = checkPassword("");
  assert.equal(r.strength, 0);
  assert.equal(r.acceptable, false);
  assert.equal(strengthLabel(r.strength), "");
});

test("short passwords are not acceptable and weak", () => {
  const r = checkPassword("abc12");
  assert.equal(r.acceptable, false);
  assert.equal(strengthLabel(r.strength), "Weak");
});

test("a long, varied password is acceptable and strong", () => {
  const r = checkPassword("correct-horse-battery-staple");
  assert.equal(r.acceptable, true);
  assert.equal(strengthLabel(r.strength), "Strong");
});

test("a repeated pattern fails the variety check", () => {
  const r = checkPassword("aaaaaaaaaaaaaaaa");
  assert.equal(r.checks.find((c) => c.id === "variety")?.ok, false);
  assert.equal(r.acceptable, false);
});

test("the email and name must not be inside the password", () => {
  assert.equal(checkPassword("ada.lovelace-2024-xyz", { email: "ada.lovelace@acme.com" }).acceptable, false);
  assert.equal(checkPassword("hello-Grace Hopper-99", { name: "Grace Hopper" }).acceptable, false);
  assert.equal(checkPassword("totally-unrelated-words", { email: "ada@acme.com", name: "Ada" }).acceptable, true);
});

test("strength grows with length", () => {
  assert.ok(checkPassword("abcdefghijkl1").strength < checkPassword("abcdefghijkl1mnopqrstuv").strength);
});
