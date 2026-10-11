import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, "../dist/tracker.global.js");
const maxSizeBytes = 6000;

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
