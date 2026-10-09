import { test } from "node:test";
import assert from "node:assert/strict";
import { DEV_DEFAULTS, loadEnvironment, productionProblems } from "./index.js";

const strong = "x".repeat(40);
const prod = {
  NODE_ENV: "production",
  NEXTAUTH_SECRET: strong,
  DATABASE_URL: "postgres://app:s3cret@db.internal:5432/growth",
  CLICKHOUSE_PASSWORD: "a-real-clickhouse-password",
  REDIS_URL: "redis://:a-real-redis-password@cache.internal:6379",
};

// Parsing logs to stderr on failure; keep test output readable.
function quiet<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

test("development runs with no environment at all", () => {
  const env = loadEnvironment({ NODE_ENV: "development" });
  assert.equal(env.NEXTAUTH_SECRET, DEV_DEFAULTS.NEXTAUTH_SECRET);
});

test("a fully configured production environment loads", () => {
  assert.doesNotThrow(() => loadEnvironment(prod));
});

for (const key of Object.keys(DEV_DEFAULTS) as (keyof typeof DEV_DEFAULTS)[]) {
  test(`production refuses to start with ${key} unset`, () => {
    const source: NodeJS.ProcessEnv = { ...prod };
    delete source[key];
    assert.throws(() => quiet(() => loadEnvironment(source)), /Unsafe production configuration/);
  });

  test(`production refuses ${key} set to the public default`, () => {
    const source: NodeJS.ProcessEnv = { ...prod, [key]: DEV_DEFAULTS[key] };
    assert.throws(() => quiet(() => loadEnvironment(source)), /Unsafe production configuration/);
  });
}

test("production requires a session secret of at least 32 characters", () => {
  assert.throws(() => quiet(() => loadEnvironment({ ...prod, NEXTAUTH_SECRET: "a".repeat(20) })), /Unsafe production/);
});

test("the production check is skipped while next build runs", () => {
  assert.doesNotThrow(() => loadEnvironment({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }));
});

test("the problems list names each offending variable", () => {
  const env = loadEnvironment({ NODE_ENV: "development" });
  const problems = productionProblems(env);
  assert.equal(problems.length, 4);
  for (const key of Object.keys(DEV_DEFAULTS)) assert.ok(problems.some((p) => p.startsWith(key)), key);
});

test("a malformed provided value still fails fast in any environment", () => {
  assert.throws(() => quiet(() => loadEnvironment({ NODE_ENV: "development", APP_URL: "not a url" })), /Invalid environment/);
});
