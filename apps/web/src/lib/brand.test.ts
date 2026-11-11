import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BRAND, markSvg } from "./brand";
import { PALETTE } from "@trackme/landing/src/palette";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the favicon files are the mark, byte for byte, in the app and in the docs site", () => {
  assert.equal(read("../app/icon.svg"), markSvg() + "\n");
  assert.equal(read("../../../tracker-docs/src/app/icon.svg"), markSvg() + "\n");
});

test("the brand colours are the palette's, and the line is the landing page's headline", () => {
  assert.equal(BRAND.ink, PALETTE.surface.ink);
  assert.equal(BRAND.page, PALETTE.surface.page);
  assert.equal(BRAND.light, PALETTE.text.strong);
  assert.match(read("../../../../packages/landing/src/landing.tsx"), /Analytics that counts visits,/);
  assert.equal(BRAND.tagline, "Analytics that counts visits, not people.");
});

test("the mark draws nine glyph cells and only palette colours", () => {
  const svg = markSvg();
  const colours = new Set([...svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/gi)].map((m) => m[1]!.toLowerCase()));
  assert.deepEqual([...colours].sort(), [PALETTE.surface.page, PALETTE.text.strong].sort());
});
