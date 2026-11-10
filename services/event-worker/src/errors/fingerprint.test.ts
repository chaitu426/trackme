import { test } from "node:test";
import assert from "node:assert/strict";
import type { ErrorPayload } from "@trackme/contracts";
import { errorTitle, fileBasename, groupId, normalizeMessage } from "./fingerprint.js";

const SITE = "a1c2e3f4-1111-4222-8333-444455556666";
const OTHER_SITE = "b1c2e3f4-1111-4222-8333-444455556666";

const base: ErrorPayload = {
  type: "TypeError",
  message: "Cannot read properties of undefined (reading 'id')",
  frames: [
    { fn: "onSubmit", file: "https://shop.test/assets/app.3f2a9c1b.js", line: 10, col: 4, inApp: true },
    { fn: "dispatch", file: "https://shop.test/assets/vendor.77aa11bb.js", line: 3, inApp: false },
  ],
};

test("the changing parts of a message do not split an issue", () => {
  assert.equal(
    normalizeMessage("Order 8841 failed for 9f3c2ab1-aaaa-bbbb-cccc-123456789abc at https://x.test/o/8841?t=1"),
    "Order <n> failed for <uuid> at <url>"
  );
  assert.equal(normalizeMessage("Timeout after 3000ms (attempt 2)"), "Timeout after <n>ms (attempt <n>)");
  assert.equal(normalizeMessage("bad id deadbeef1234"), "bad id <hex>");
});

test("the same bug groups together across builds, line numbers and ids", () => {
  const later: ErrorPayload = {
    ...base,
    message: "Cannot read properties of undefined (reading 'id')",
    frames: [
      { fn: "onSubmit", file: "https://shop.test/assets/app.99ff00aa.js", line: 482, col: 90, inApp: true },
      { fn: "other", file: "https://shop.test/assets/vendor.00112233.js", line: 9, inApp: false },
    ],
  };
  assert.equal(groupId(SITE, base), groupId(SITE, later));
});

test("a different type, message or function is a different issue", () => {
  const id = groupId(SITE, base);
  assert.notEqual(id, groupId(SITE, { ...base, type: "RangeError" }));
  assert.notEqual(id, groupId(SITE, { ...base, message: "x is not a function" }));
  assert.notEqual(id, groupId(SITE, { ...base, frames: [{ fn: "onClick", file: "app.js", inApp: true }] }));
});

test("only in-app frames count when there are any, and only the top three", () => {
  const withLibraryOnTop: ErrorPayload = {
    ...base,
    frames: [{ fn: "libFn", file: "vendor.js", inApp: false }, ...(base.frames ?? [])],
  };
  assert.equal(groupId(SITE, base), groupId(SITE, withLibraryOnTop));
  const deep = (extra: string): ErrorPayload => ({
    ...base,
    frames: [
      ...Array.from({ length: 3 }, (_, i) => ({ fn: `f${i}`, file: "app.js", inApp: true })),
      { fn: extra, file: "app.js", inApp: true },
    ],
  });
  assert.equal(groupId(SITE, deep("a")), groupId(SITE, deep("b")));
});

test("with no frames the group still forms from type and message", () => {
  const bare: ErrorPayload = { type: "Error", message: "Script error." };
  assert.equal(groupId(SITE, bare), groupId(SITE, { ...bare }));
});

test("a custom fingerprint overrides everything else", () => {
  const a = groupId(SITE, { ...base, fingerprint: "checkout-null-user" });
  const b = groupId(SITE, { type: "Other", message: "different", fingerprint: "checkout-null-user" });
  assert.equal(a, b);
  assert.notEqual(a, groupId(SITE, base));
});

test("the same bug on two sites never shares an id", () => {
  assert.notEqual(groupId(SITE, base), groupId(OTHER_SITE, base));
});

test("the id is a UInt64 decimal string", () => {
  assert.match(groupId(SITE, base), /^\d{1,20}$/);
  assert.ok(BigInt(groupId(SITE, base)) < 2n ** 64n);
});

test("bundle content hashes are dropped from file names", () => {
  assert.equal(fileBasename("https://cdn.test/assets/app.3f2a9c1b.js?v=1#x"), "app.js");
  assert.equal(fileBasename("/static/main-a1b2c3d4.js"), "main.js");
  assert.equal(fileBasename("checkout.js"), "checkout.js");
});

test("the title reads type then message and is capped", () => {
  assert.equal(errorTitle({ type: "TypeError", message: "boom\n  here" }), "TypeError: boom here");
  assert.equal(errorTitle({ type: "Error", message: "" }), "Error");
  assert.equal(errorTitle({ type: "Error", message: "m".repeat(500) }).length, 200);
});
