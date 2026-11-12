import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError, type WorkspaceRole } from "@trackme/contracts";
import { ALL_PERMISSIONS, API_KEY_DENIED, hasPermission } from "./permissions.js";
import { ROLE_RANK, canChangeRole, canInviteRole, canRemoveMember, effectiveWorkspaceRole } from "./roles.js";
import { assertPermission } from "./tenancy.js";

const ROLES: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

test("the role matrix is exactly what the settings page promises", () => {
  const grants = (role: WorkspaceRole) => ALL_PERMISSIONS.filter((p) => hasPermission(role, p)).sort();
  assert.deepEqual(grants("owner"), [...ALL_PERMISSIONS].sort());
  assert.deepEqual(grants("admin"), ALL_PERMISSIONS.filter((p) => p !== "workspace:billing").sort());
  assert.deepEqual(grants("member"), ["analytics:read", "exports:create", "goals:manage", "members:read", "sites:create", "sites:update"]);
  assert.deepEqual(grants("viewer"), ["analytics:read"]);
});

test("billing is owner-only and the member list is hidden from viewers", () => {
  for (const role of ROLES) assert.equal(hasPermission(role, "workspace:billing"), role === "owner");
  assert.equal(hasPermission("viewer", "members:read"), false);
});

test("an API key never gets people, billing, key or erase permissions, even as an admin", () => {
  const key = { userId: "api-key:x", workspaceId: "w", role: "admin", principal: "api_key" } as const;
  for (const permission of API_KEY_DENIED) {
    assert.throws(() => assertPermission(key, permission), (e) => e instanceof AppError && e.status === 403);
    assertPermission({ userId: "u", workspaceId: "w", role: "owner" }, permission);
  }
  assertPermission(key, "alerts:manage");
});

test("an admin cannot invite, change or remove another admin, but the owner can", () => {
  assert.equal(canInviteRole("admin", "admin"), false);
  assert.equal(canInviteRole("admin", "member"), true);
  assert.equal(canInviteRole("owner", "admin"), true);
  assert.equal(canInviteRole("owner", "owner"), false);

  assert.equal(canChangeRole("admin", "admin", "member"), false);
  assert.equal(canChangeRole("admin", "member", "admin"), false);
  assert.equal(canChangeRole("admin", "member", "viewer"), true);
  assert.equal(canChangeRole("owner", "admin", "member"), true);
  assert.equal(canChangeRole("owner", "member", "owner"), false);
  assert.equal(canChangeRole("owner", "owner", "admin"), false);
  assert.equal(canChangeRole("member", "viewer", "member"), false);

  assert.equal(canRemoveMember("admin", "admin"), false);
  assert.equal(canRemoveMember("admin", "member"), true);
  assert.equal(canRemoveMember("owner", "admin"), true);
  assert.equal(canRemoveMember("owner", "owner"), false);
  // Rank alone: a member outranks a viewer, but `workspace:members` (checked first by the route) stops them.
  assert.equal(hasPermission("member", "workspace:members"), false);
});

test("a company owner is an owner of every workspace in the company; other company roles add nothing", () => {
  assert.equal(effectiveWorkspaceRole(null, "owner"), "owner");
  assert.equal(effectiveWorkspaceRole("viewer", "owner"), "owner");
  assert.equal(effectiveWorkspaceRole("member", "billing_admin"), "member");
  assert.equal(effectiveWorkspaceRole(null, "billing_admin"), null);
  assert.equal(effectiveWorkspaceRole("admin", null), "admin");
  assert.equal(effectiveWorkspaceRole(undefined, undefined), null);
});

test("rank is a strict order", () => {
  assert.equal(new Set(ROLES.map((r) => ROLE_RANK[r])).size, ROLES.length);
});

/** Every route names a real permission: no aliases, no scope strings, no defaults. */
test("every authenticateRequest / authorizeSite call in the web app names a real permission", () => {
  const root = fileURLToPath(new URL("../../../apps/web/src", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      // These two define the helpers and forward a typed `Permission` variable, so there is no literal to check.
      else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts") && !["tenancy.ts", "site-access.ts"].includes(entry)) files.push(full);
    }
  };
  walk(root);

  const valid = new Set<string>(ALL_PERMISSIONS);
  const problems: string[] = [];
  let calls = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\b(authenticateRequest|authorizeSite)\(\s*([^,()]+),\s*([^,()]+),\s*([^,)]+)\s*[,)]/g)) {
      calls += 1;
      const arg = m[4]!.trim();
      const literal = /^"([^"]+)"$/.exec(arg)?.[1];
      if (!literal || !valid.has(literal)) problems.push(`${file}: ${m[1]}(..., ${arg})`);
    }
    for (const m of text.matchAll(/\bauthenticateRequest\(\s*[^,()]+,\s*[^,()]+\s*\)/g)) {
      problems.push(`${file}: authenticateRequest with no permission: ${m[0]}`);
    }
  }
  assert.ok(calls > 20, `expected to scan the routes, found ${calls} calls`);
  assert.deepEqual(problems, []);
});
