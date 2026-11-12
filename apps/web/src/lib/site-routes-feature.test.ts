import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURES } from "@trackme/contracts";

/** Routes under /sites/:siteId that are open to any member on purpose, with the reason. */
const ALLOWED_WITHOUT_FEATURE: Record<string, string> = {
  "first-event/route.ts": "the setup check that the tracker is installed; every member of a new site needs it",
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? routeFiles(full) : entry === "route.ts" ? [full] : [];
  });
}

test("every per-site API route checks the feature it belongs to, so teams cannot be bypassed through the API", () => {
  const root = fileURLToPath(new URL("../app/api/v1/sites/[siteId]", import.meta.url));
  const files = routeFiles(root);
  assert.ok(files.length >= 10, `expected to find the site routes, found ${files.length}`);

  const problems: string[] = [];
  for (const file of files) {
    const rel = file.slice(root.length + 1).replaceAll("\\", "/");
    if (rel in ALLOWED_WITHOUT_FEATURE) continue;
    const text = readFileSync(file, "utf8");

    const guarded = [
      // requireSiteAccess(request, siteId, "perm", "feature") and authorizeSite(...)
      ...[...text.matchAll(/\b(?:requireSiteAccess|authorizeSite)\(\s*request,\s*siteId,\s*"[a-z:_]+"(?:,\s*"([a-z_]+)")?\s*\)/g)].map((m) => m[1]),
      // authenticateSite(request, workspaceId, siteId, "perm", "feature")
      // requireMetricsAccess(request, workspaceId, siteId[, "feature"]): the feature defaults to traffic.
      ...[...text.matchAll(/\brequireMetricsAccess\(/g)].map(() => "acquisition"),
      ...[...text.matchAll(/\bauthenticateSite\(\s*[^,()]+,\s*[^,()]+,\s*[^,()]+,\s*"[a-z:_]+",\s*"([a-z_]+)"\s*\)/g)].map((m) => m[1]),
    ];
    const handlers = [...text.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].length;
    const other = [...text.matchAll(/\b(?:requireSiteAccess|authorizeSite|authenticateSite|authenticateRequest|requireMetricsAccess)\(/g)].length;

    if (other === 0) problems.push(`${rel}: no access check at all`);
    if (guarded.length !== other) problems.push(`${rel}: ${other - guarded.length} access check(s) name no feature`);
    for (const f of guarded) if (!f || !(FEATURES as readonly string[]).includes(f)) problems.push(`${rel}: '${f}' is not a feature`);
    if (guarded.length < handlers) problems.push(`${rel}: ${handlers} handlers but only ${guarded.length} feature checks`);
  }
  assert.deepEqual(problems, []);
});
