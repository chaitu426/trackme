import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

// The lazy chunks the bundle loads (web vitals, error capture). They are fetched from beside whichever file the
// page loaded, so each location that serves tracker.js serves them too.
const chunkFiles = (manifest.chunks ?? []).map((chunk) => chunk.file);
for (const file of chunkFiles) {
  const from = path.join(distDir, file);
  if (!existsSync(from)) {
    console.error(`[copy-tracker-assets] Missing chunk ${file}`);
    process.exit(1);
  }
  copyFileSync(from, path.join(destDir, file));
  copyFileSync(from, path.join(v1Dir, file));
}

// The immutable, content-hashed file. Its name changes whenever its bytes do, so a page that references it
// (with the integrity hash below) gets exactly this code or nothing: a later change to /tracker.js, or to this
// server, cannot silently alter what an existing install runs. Snippets use this by default (lib/tracker-url.ts).
const pinnedDir = path.join(destDir, "t", manifest.latest);
mkdirSync(pinnedDir, { recursive: true });
copyFileSync(source, path.join(pinnedDir, manifest.file));
for (const file of chunkFiles) copyFileSync(path.join(distDir, file), path.join(pinnedDir, file));
writeFileSync(
  path.join(destDir, "t", "manifest.json"),
  JSON.stringify({ version: manifest.latest, path: `/t/${manifest.latest}/${manifest.file}`, integrity: manifest.sri }, null, 2)
);
console.log(`[copy-tracker-assets] Copied tracker bundle -> ${path.join(destDir, "tracker.js")}`);
