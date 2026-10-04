import { defineConfig } from "tsup";

export default defineConfig([
  // Standalone script bundle for <script src="...">
  {
    entry: {
      tracker: "src/index.ts",
    },
    format: ["iife"],
    outDir: "dist",
    minify: true,
    target: "es2020",
    globalName: "GrowthIntelligence",
    clean: true,
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
  },
]);
