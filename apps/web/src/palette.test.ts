import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PALETTE } from "../../../packages/landing/src/palette";

const css = readFileSync(path.resolve(import.meta.dirname, "app/globals.css"), "utf8");
const token = (name: string) => {
  const line = css.split(/\r?\n/).find((l) => l.trim().startsWith(`--${name}:`));
  return /#[0-9a-fA-F]{6}/.exec(line ?? "")?.[0].toLowerCase();
};

test("globals.css repeats the palette exactly, so a class and a CSS variable can never disagree", () => {
  const expected: Record<string, string> = {
    sidebar: PALETTE.surface.ink,
    background: PALETTE.surface.page,
    card: PALETTE.surface.card,
    raised: PALETTE.surface.raised,
    foreground: PALETTE.text.strong,
    "muted-foreground": PALETTE.text.body,
    success: PALETTE.signal.good,
    warning: PALETTE.signal.warn,
    danger: PALETTE.signal.bad,
    chart: PALETTE.chart.bright,
    "chart-muted": PALETTE.chart.dim,
    sparkline: PALETTE.signal.good,
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(token(name), value, `--${name}`);
});

test("the palette is graphite plus three signals, nothing else", () => {
  assert.deepEqual(Object.keys(PALETTE.signal), ["good", "warn", "bad"]);
  assert.deepEqual(Object.keys(PALETTE.surface), ["ink", "page", "card", "raised"]);
});
