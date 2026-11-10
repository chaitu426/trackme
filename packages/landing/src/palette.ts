/**
 * The one palette: Graphite and Signal.
 *
 * Everything is graphite (near-black surfaces, off-white text) except three signal colours that carry meaning and nothing else:
 * good, warn, bad. Charts use the off-white as their one bright mark and a dim graphite for the rest. There is no brand hue; the
 * matrix glyph pictures and the data are what make the product recognisable.
 *
 * This file is the single source. Both Tailwind configs (the app and the docs) read it, `globals.css` repeats the values as CSS
 * variables for the places that cannot use a class, and `palette.test.ts` fails if the two disagree.
 */
export const PALETTE = {
  /** Surfaces, darkest to lightest. */
  surface: {
    /** Sidebar, the inset behind cards, the hero and footer. */
    ink: "#0f0f10",
    /** The page. */
    page: "#141415",
    /** A card, a menu, a dialog. */
    card: "#19191b",
    /** A control that is selected or raised: active tab, secondary button. */
    raised: "#232325",
  },
  /** Text, strongest to quietest. Three roles are enough; the lightest two meet 4.5:1 on page and card. */
  text: {
    strong: "#ededed",
    body: "#a1a1aa",
    muted: "#85858b",
    faint: "#6e6e74",
  },
  /** Meaning. Green is good, amber is a warning, red is wrong. Never decoration. */
  signal: {
    good: "#4cc38a",
    warn: "#fbbf24",
    bad: "#e5484d",
  },
  /** The one bright chart mark, and the dim mark beside it. */
  chart: {
    bright: "#ededed",
    dim: "#3f3f46",
  },
} as const;

/** Tailwind colours derived from the palette, so a class like `text-good` or `bg-bad/15` always means the same thing. */
export const PALETTE_COLORS = {
  ink: PALETTE.surface.ink,
  good: PALETTE.signal.good,
  warn: PALETTE.signal.warn,
  bad: PALETTE.signal.bad,
  zinc: { 500: PALETTE.text.muted, 600: PALETTE.text.faint },
} as const;
