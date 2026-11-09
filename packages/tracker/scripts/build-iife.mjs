// Builds the standalone <script> bundle and its lazy chunks.
//
// Each chunk (src/chunks/<name>.ts) becomes dist/tracker.<name>.<hash>.js, named by its content so it can be cached
// forever. The main bundle is built last, with every chunk's file name and sha384 baked in (see src/lazy.ts), so
// tracker.js can only ever load, and verify, the exact chunks it was built with.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const scratch = path.join(dist, ".chunks");
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const CHUNKS = ["vitals", "errors"];

const common = {
  format: ["iife"],
  minify: true,
  target: "es2020",
  clean: false,
  dts: false,
  silent: true,
  noExternal: ["web-vitals"],
  define: { __TRACKER_VERSION__: JSON.stringify(version) },
};

mkdirSync(scratch, { recursive: true });
const chunks = {};
for (const name of CHUNKS) {
  await build({ ...common, entry: { [name]: `src/chunks/${name}.ts` }, outDir: scratch });
  const raw = readFileSync(path.join(scratch, `${name}.global.js`));
  const file = `tracker.${name}.${createHash("sha256").update(raw).digest("hex").slice(0, 8)}.js`;
  writeFileSync(path.join(dist, file), raw);
  chunks[name] = { f: file, i: `sha384-${createHash("sha384").update(raw).digest("base64")}` };
}
rmSync(scratch, { recursive: true, force: true });

await build({
  ...common,
  entry: { tracker: "src/browser.ts" },
  outDir: dist,
  define: { ...common.define, __LAZY__: "true", __CHUNKS__: JSON.stringify(chunks) },
});

writeFileSync(path.join(dist, "chunks.json"), JSON.stringify(chunks, null, 2));
console.log(`[tracker-build] chunks: ${Object.values(chunks).map((c) => c.f).join(", ")}`);
