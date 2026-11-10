import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig([
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
      // The standalone script and its lazy chunks are built by scripts/build-iife.mjs.
      __LAZY__: "false",
    },
  },
]);
