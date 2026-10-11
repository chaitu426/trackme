import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { brotliCompressSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");
const packageJsonPath = path.resolve(__dirname, "../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const source = path.join(distDir, "tracker.global.js");
const raw = readFileSync(source);
const versionHash = createHash("sha256").update(raw).digest("hex").slice(0, 8);
const outputName = `tracker.${packageJson.version}.${versionHash}.js`;
const outputPath = path.join(distDir, outputName);

writeFileSync(outputPath, raw);
writeFileSync(path.join(distDir, `${outputName}.br`), brotliCompressSync(raw));
writeFileSync(path.join(distDir, "manifest.json"), JSON.stringify({
  latest: packageJson.version,
  file: outputName,
  sri: `sha384-${createHash("sha384").update(raw).digest("base64")}`,
}, null, 2));

const aliasRoot = path.resolve(__dirname, "../../../apps/web/public");
mkdirSync(path.join(aliasRoot, "t", "v1"), { recursive: true });
copyFileSync(outputPath, path.join(aliasRoot, "tracker.js"));
copyFileSync(outputPath, path.join(aliasRoot, "t", "v1", "tracker.js"));
const mapSource = path.join(distDir, "tracker.global.js.map");
if (existsSync(mapSource)) {
  copyFileSync(mapSource, path.join(aliasRoot, "t", "v1", "tracker.js.map"));
}

console.log(`[tracker-versioned-build] wrote ${outputName}`);
