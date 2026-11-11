import { PALETTE } from "@trackme/landing/src/palette";

/**
 * The brand in one place: the name, the line, and the mark as an SVG. The favicon, the touch icon, the social card and the manifest all
 * read this, so changing the line or the colours changes every surface at once. The mark is the product logo (a light tile holding
 * the 3 by 3 glyph wave, see packages/landing/src/logo-mark.tsx) drawn as shapes, so it is crisp at 16 px and needs no font.
 */
export const BRAND = {
  name: "TrackMe",
  /** The line. It is the landing page's headline; do not write a second one. */
  tagline: "Analytics that counts visits, not people.",
  description:
    "Live traffic, funnels, errors, release impact and payments from a tag under 10 KB. No tracking cookies, and no IP address is ever stored.",
  ink: PALETTE.surface.ink,
  page: PALETTE.surface.page,
  light: PALETTE.text.strong,
} as const;

/** One frame of the wave, as ramp levels: 0 is `.`, 1 `:`, 2 `+`, 3 `#`. */
const WAVE = [0, 1, 2, 1, 2, 3, 2, 3, 2];
const OPACITY = [0.35, 0.57, 0.79, 1.01];

function glyph(level: number, cx: number, cy: number, fill: string): string {
  const o = Math.min(1, OPACITY[level]!).toFixed(2);
  if (level === 0) return `<circle cx="${cx}" cy="${cy}" r="1.3" fill="${fill}" opacity="${o}"/>`;
  if (level === 1) return `<circle cx="${cx}" cy="${cy - 2.6}" r="1.3" fill="${fill}" opacity="${o}"/><circle cx="${cx}" cy="${cy + 2.6}" r="1.3" fill="${fill}" opacity="${o}"/>`;
  if (level === 2) return `<path d="M${cx - 3} ${cy}H${cx + 3}M${cx} ${cy - 3}V${cy + 3}" stroke="${fill}" stroke-width="1.7" stroke-linecap="square" opacity="${o}"/>`;
  return `<path d="M${cx - 1.5} ${cy - 3.2}V${cy + 3.2}M${cx + 1.5} ${cy - 3.2}V${cy + 3.2}M${cx - 3.2} ${cy - 1.5}H${cx + 3.2}M${cx - 3.2} ${cy + 1.5}H${cx + 3.2}" stroke="${fill}" stroke-width="1.3" opacity="${o}"/>`;
}

/** The mark on a 32 by 32 canvas. `rounded` is the tile's corner radius (0 for a full-bleed touch icon). */
export function markSvg(rounded = 7): string {
  const centers = [9.5, 16, 22.5];
  const cells = WAVE.map((level, i) => glyph(level, centers[i % 3]!, centers[Math.floor(i / 3)]!, BRAND.page)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><rect width="32" height="32" rx="${rounded}" fill="${BRAND.light}"/>${cells}</svg>`;
}

/** A data URI of the mark, for the image routes (Satori draws an <img>, not inline SVG). */
export function markDataUri(rounded = 7): string {
  return `data:image/svg+xml;base64,${Buffer.from(markSvg(rounded)).toString("base64")}`;
}

/** The app's public origin, for absolute URLs in metadata and the sitemap. */
export function appOrigin(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}
