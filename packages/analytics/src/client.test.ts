import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDashboardCredentials } from "./client.js";

const base = { CLICKHOUSE_USER: "default", CLICKHOUSE_PASSWORD: "main-pw" };

test("the dashboard user is used when configured", () => {
  const creds = resolveDashboardCredentials({
    ...base,
    NODE_ENV: "production",
    CLICKHOUSE_DASHBOARD_USER: "dashboard_ro",
    CLICKHOUSE_DASHBOARD_PASSWORD: "ro-pw",
  });
  assert.deepEqual(creds, { username: "dashboard_ro", password: "ro-pw" });
});

test("production refuses to fall back to the write user", () => {
  assert.throws(() => resolveDashboardCredentials({ ...base, NODE_ENV: "production" }), /CLICKHOUSE_DASHBOARD_USER is required/);
  assert.throws(
    () => resolveDashboardCredentials({ ...base, NODE_ENV: "production", CLICKHOUSE_DASHBOARD_USER: "  " }),
    /required in production/
  );
});

test("development falls back to the main user so a fresh checkout works", () => {
  assert.deepEqual(resolveDashboardCredentials({ ...base, NODE_ENV: "development" }), {
    username: "default",
    password: "main-pw",
  });
});
