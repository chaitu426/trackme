import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Publishes the immutable CDN bundle and the short-lived alias so the tracker
// can be served from the app origin during rollout without depending on the
// CDN host for same-origin demos.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../../../packages/tracker/dist");
const manifestPath = path.join(distDir, "manifest.json");
const destDir = path.resolve(__dirname, "../public");
const v1Dir = path.join(destDir, "t", "v1");

if (!existsSync(manifestPath)) {
  console.error(
    `[copy-tracker-assets] Missing tracker manifest at ${manifestPath}.\n` +
      "Build it first: pnpm --filter @trackme/tracker build"
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const source = path.join(distDir, manifest.file);
if (!existsSync(source)) {
  console.error(`[copy-tracker-assets] Missing immutable tracker build ${manifest.file}`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
mkdirSync(v1Dir, { recursive: true });
copyFileSync(source, path.join(destDir, "tracker.js"));
copyFileSync(source, path.join(v1Dir, "tracker.js"));
console.log(`[copy-tracker-assets] Copied tracker bundle -> ${path.join(destDir, "tracker.js")}`);
