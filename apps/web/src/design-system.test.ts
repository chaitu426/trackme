import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The design system's guard rails. Each rule is a way the app used to drift (a one-off colour, a browser dialog, an animation
 * class that does nothing here). The test reads every component and page and fails with the file and line, so a mismatch is
 * caught in review instead of discovered on screen. Charts and illustrations that draw their own pixels are exempt, by name.
 * See docs/design/design-system.md for what to use instead.
 */
const SRC = path.resolve(import.meta.dirname, ".");
const EXEMPT = ["geo-globe.tsx", "journey-sankey.tsx", "ui/sparkline.tsx", "audience-map.tsx", "route-flow.tsx", "time-series-chart.tsx", "vitals-pulse.tsx", "globe-demo.tsx"];

const RULES: Array<{ name: string; pattern: RegExp; use: string; allow?: string[] }> = [
  { name: "tailwindcss-animate classes (the plugin is not installed, so they do nothing)", pattern: /\banimate-in\b|\bfade-in-0\b|\bslide-in-from-/, use: "the .enter, .animate-fade-in or motion components" },
  { name: "transition-all (animates layout and everything else)", pattern: /\btransition-all\b/, use: "transition-colors, transition-[transform,opacity] or the .press class" },
  { name: "browser dialogs", pattern: /\b(?:window\.)?(?:alert|confirm|prompt)\(/, use: "ConfirmDialog, ConfirmAction or toast()" },
  { name: "hand-built near-black fills", pattern: /\bbg-zinc-(?:900|950)\b/, use: "bg-card, bg-raised or bg-white/[0.03]" },
  { name: "heavy shadows", pattern: /\bshadow-(?:lg|xl|2xl)\b/, use: "shadow-float on a floating surface, nothing on a card" },
  { name: "borders off the token", pattern: /border-white\/10(?![\d\[])/, use: "border-border" },
  { name: "a raw select", pattern: /<select\b/, use: "NativeSelect from ui/field, or SelectDropdown", allow: ["ui/field.tsx"] },
  { name: "hue colours (the palette is graphite plus the success, warning and danger greens, ambers and reds)", pattern: /\b(?:bg|text|border|ring|from|to)-(?:violet|indigo|purple|fuchsia|pink|rose|emerald|teal|cyan|sky|blue)-\d{2,3}/, use: "text-good, text-warn, text-bad or neutral zinc" },
  { name: "signal colours written as hex (the palette has classes for them)", pattern: /\b(?:bg|text|border|ring|fill|stroke|from|to|via)-\[#(?:4cc38a|e5484d|fbbf24)\]/i, use: "text-good, bg-bad/10, border-warn/30 and the other palette classes" },
  { name: "colours outside the palette (greens, reds and ambers other than good, bad and warn)", pattern: /\b(?:bg|text|border|ring|from|to|via)-(?:green|red|yellow|orange|lime|stone|gray|slate|amber)-\d{2,3}/, use: "text-good, text-bad, text-warn or neutral zinc" },
  { name: "old signal hex values", pattern: /#(?:22c55e|ef4444|eab308|f59e0b)\b/i, use: "the palette values in packages/landing/src/palette.ts" },
  { name: "colour gradients", pattern: /\bbg-gradient-to-[a-z]+\b[^"'`]*\b(?:from|via|to)-(?!transparent|background|\[#0f0f10\])/, use: "flat surfaces; a gradient only fades a neutral to transparent" },
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx$/.test(name) ? [full] : [];
  });
}

for (const rule of RULES) {
  test(`no ${rule.name}`, () => {
    const found: string[] = [];
    for (const file of files(SRC)) {
      const rel = path.relative(SRC, file).replaceAll("\\", "/");
      if (EXEMPT.some((e) => rel.endsWith(e)) || rule.allow?.some((a) => rel.endsWith(a))) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (rule.pattern.test(line)) found.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
        });
    }
    assert.equal(found.length, 0, `${found.length} use(s). Use ${rule.use} instead:\n${found.join("\n")}`);
  });
}
