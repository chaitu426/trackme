import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATURES, effectiveLevel, featureForSitePath, visibleFeatures, canView, canManageFeature, type AccessInput, type FeatureGrant } from "./access.js";

const input = (role: AccessInput["role"], restricted: boolean, grants: FeatureGrant[] = []): AccessInput => ({ role, restricted, grants });

test("owners and admins have everything, restricted or not, with no grants at all", () => {
  for (const role of ["owner", "admin"] as const) {
    for (const restricted of [true, false]) {
      for (const f of FEATURES) assert.equal(effectiveLevel(input(role, restricted), f), "manage");
    }
  }
});

test("without restrictions the role decides: members manage, viewers only view", () => {
  for (const f of FEATURES) {
    assert.equal(effectiveLevel(input("member", false), f), "manage");
    assert.equal(effectiveLevel(input("viewer", false), f), "view");
  }
});

test("with restrictions, no grant means no access", () => {
  for (const role of ["member", "viewer"] as const) {
    for (const f of FEATURES) assert.equal(effectiveLevel(input(role, true), f), null);
    assert.deepEqual(visibleFeatures(input(role, true)), []);
  }
});

test("a grant opens exactly the feature it names", () => {
  const i = input("member", true, [{ feature: "errors", level: "view" }]);
  assert.equal(effectiveLevel(i, "errors"), "view");
  assert.equal(effectiveLevel(i, "payments"), null);
  assert.deepEqual(visibleFeatures(i), ["errors"]);
});

test("when several grants name a feature, the highest wins", () => {
  const i = input("member", true, [
    { feature: "errors", level: "view" },
    { feature: "errors", level: "manage" },
    { feature: "funnels", level: "manage" },
    { feature: "funnels", level: "view" },
  ]);
  assert.equal(effectiveLevel(i, "errors"), "manage");
  assert.equal(effectiveLevel(i, "funnels"), "manage");
});

test("a grant never raises someone above their role: a viewer stays read-only", () => {
  const i = input("viewer", true, [{ feature: "payments", level: "manage" }]);
  assert.equal(effectiveLevel(i, "payments"), "view");
});

test("view and manage helpers", () => {
  assert.equal(canView(null), false);
  assert.equal(canView("view"), true);
  assert.equal(canManageFeature("view"), false);
  assert.equal(canManageFeature("manage"), true);
});

test("every dashboard page maps to a feature, and settings pages to site settings", () => {
  assert.equal(featureForSitePath("errors/abc"), "errors");
  assert.equal(featureForSitePath("payments/leaks"), "payments");
  assert.equal(featureForSitePath("settings"), "site_settings");
  assert.equal(featureForSitePath("vitals"), "releases");
  assert.equal(featureForSitePath("realtime"), "acquisition");
  assert.equal(featureForSitePath("nonsense"), null);
  assert.equal(featureForSitePath(""), null);
});

import { explainAccess } from "./access.js";

test("explainAccess: admins and unrestricted workspaces get access from their role", () => {
  for (const e of explainAccess({ role: "admin", restricted: true }, [])) {
    assert.equal(e.source, "role");
    assert.equal(e.level, "manage");
  }
  const member = explainAccess({ role: "member", restricted: false }, []);
  assert.ok(member.every((e) => e.source === "role" && e.level === "manage"));
  const viewer = explainAccess({ role: "viewer", restricted: false }, []);
  assert.ok(viewer.every((e) => e.level === "view"));
});

test("explainAccess: restricted access names the teams that give it", () => {
  const out = explainAccess({ role: "member", restricted: true }, [
    { team: "Engineering", feature: "errors", level: "manage" },
    { team: "QA", feature: "errors", level: "view" },
    { team: "Marketing", feature: "acquisition", level: "view" },
    { team: null, feature: "payments", level: "view" },
  ]);
  const by = Object.fromEntries(out.map((e) => [e.feature, e]));
  assert.deepEqual([by.errors!.level, by.errors!.source, by.errors!.via], ["manage", "team", ["Engineering"]]);
  assert.deepEqual([by.acquisition!.source, by.acquisition!.via], ["team", ["Marketing"]]);
  assert.deepEqual([by.payments!.source, by.payments!.via], ["person", ["Personal grant"]]);
  assert.deepEqual([by.people!.level, by.people!.source, by.people!.via], [null, "none", []]);
});

test("explainAccess: two teams reaching the same level are both named, once each", () => {
  const out = explainAccess({ role: "member", restricted: true }, [
    { team: "QA", feature: "errors", level: "view" },
    { team: "Support", feature: "errors", level: "view" },
    { team: "QA", feature: "errors", level: "view" },
  ]);
  assert.deepEqual(out.find((e) => e.feature === "errors")!.via, ["QA", "Support"]);
});

test("explainAccess: a viewer's manage grant is shown capped at view", () => {
  const out = explainAccess({ role: "viewer", restricted: true }, [{ team: "Finance", feature: "payments", level: "manage" }]);
  const payments = out.find((e) => e.feature === "payments")!;
  assert.equal(payments.level, "view");
  assert.deepEqual(payments.via, ["Finance"]);
});
