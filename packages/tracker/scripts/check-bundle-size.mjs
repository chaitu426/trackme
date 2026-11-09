import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, "../dist/tracker.global.js");
// Core budget. Web vitals (3.5 KB) and error capture (3.4 KB) are lazy chunks, so the core is about 7.9 KB; keep it there.
const maxSizeBytes = 8000;

if (!fs.existsSync(distPath)) {
  console.error(`Bundle size check failed: ${distPath} does not exist. Run the tracker build first.`);
  process.exit(1);
}

const bundle = fs.readFileSync(distPath);
const gzipBytes = gzipSync(bundle).length;

if (gzipBytes > maxSizeBytes) {
  console.error(
    `Bundle size check failed: tracker.global.js gzipped to ${gzipBytes} bytes, exceeding the ${maxSizeBytes} byte budget.`
  );
  process.exit(1);
}

console.log(`Bundle size OK: tracker.global.js gzipped to ${gzipBytes} bytes (budget ${maxSizeBytes} bytes).`);

// Each lazy chunk has its own budget: they are downloaded on demand, so growth costs visitors who use the feature.
const chunkBudgets = { vitals: 3800, errors: 4500 };
const chunksFile = path.join(__dirname, "../dist/chunks.json");
if (fs.existsSync(chunksFile)) {
  const chunks = JSON.parse(fs.readFileSync(chunksFile, "utf8"));
  for (const [name, chunk] of Object.entries(chunks)) {
    const size = gzipSync(fs.readFileSync(path.join(__dirname, "../dist", chunk.f))).length;
    const budget = chunkBudgets[name] ?? 4000;
    if (size > budget) {
      console.error(`Bundle size check failed: chunk ${name} gzipped to ${size} bytes, exceeding the ${budget} byte budget.`);
      process.exit(1);
    }
    console.log(`Chunk ${name} OK: ${size} bytes (budget ${budget} bytes).`);
  }
}
