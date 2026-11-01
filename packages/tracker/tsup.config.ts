import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig([
  // Standalone script bundle for <script src="...">
  {
    entry: {
      tracker: "src/browser.ts",
    },
    format: ["iife"],
    noExternal: ["web-vitals"],
    outDir: "dist",
    minify: true,
    target: "es2020",
    clean: false,
    define: {
      __TRACKER_VERSION__: JSON.stringify(packageJson.version),
    },
  },
  // NPM module build for ESM and CJS imports
  {
    entry: {
      index: "src/index.ts",
      adapters: "src/adapters.ts",
    },
    format: ["esm", "cjs"],
    outDir: "dist",
    dts: true,
    clean: false,
    define: {
      __TRACKER_VERSION__: JSON.stringify(packageJson.version),
    },
  },
]);
