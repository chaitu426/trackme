// Builds the edge binary with the right file name for the platform (.exe on Windows,
// which cannot spawn an extensionless executable).
import { spawnSync } from "node:child_process";

const out = process.platform === "win32" ? "bin/ingestion-go.exe" : "bin/ingestion-go";
const result = spawnSync("go", ["build", "-o", out, "./cmd/server"], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
