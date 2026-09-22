import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Publishes the browser tracker bundle at /tracker.js so the snippet shown
// in onboarding and site settings (`{APP_URL}/tracker.js`) actually resolves.
// Must run after @trackme/tracker has been built.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tsup names the IIFE build "tracker.global.js" since the same entry name
// is also used for the ESM/CJS npm build ("index.js"/"index.mjs").
const source = path.resolve(__dirname, "../../../packages/tracker/dist/tracker.global.js");
const destDir = path.resolve(__dirname, "../public");
const dest = path.join(destDir, "tracker.js");

if (!existsSync(source)) {
  console.error(
    `[copy-tracker-assets] Missing built tracker bundle at ${source}.\n` +
      "Build it first: pnpm --filter @trackme/tracker build"
  );
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(source, dest);
console.log(`[copy-tracker-assets] Copied tracker bundle -> ${dest}`);
