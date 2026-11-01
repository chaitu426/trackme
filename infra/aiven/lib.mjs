// Shared helpers for the Aiven scripts. Dependencies are resolved from the workspace
// packages that already install them, so this folder needs no package.json.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../..");

export function requireFrom(workspaceDir, id) {
  return createRequire(path.join(repoRoot, workspaceDir, "package.json"))(id);
}

/** Load infra/aiven/.env.aiven (or the file named by ENV_FILE) without overriding the real environment. */
export function loadEnv() {
  const dotenv = requireFrom("packages/config", "dotenv");
  const file = process.env.ENV_FILE ?? path.join(repoRoot, ".env.aiven");
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file}. Copy infra/aiven/.env.aiven.example to .env.aiven in the repo root and fill it in.`);
    process.exit(1);
  }
  dotenv.config({ path: file });
  return file;
}

export function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
  return value;
}

/**
 * Split a SQL file into statements. Whole-line `--` comments are dropped first so a
 * semicolon inside a comment cannot split a statement. Migrations in this repo do not
 * put semicolons inside string literals.
 */
export function splitStatements(sql) {
  const withoutComments = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}
