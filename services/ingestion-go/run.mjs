// Cross-platform launcher for the compiled edge: `./bin/ingestion-go` is not valid in
// Windows cmd, which is what pnpm scripts run under there.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = ["bin/ingestion-go.exe", "bin/ingestion-go"].map((p) => path.join(here, p));
const binary = candidates.find((p) => fs.existsSync(p));
if (!binary) {
  console.error("bin/ingestion-go not found. Run `pnpm build:app` (or `pnpm --filter @trackme/ingestion-go build`) first.");
  process.exit(1);
}

const child = spawn(binary, { cwd: here, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
