// Same page, same colour, everywhere: the journey list, the flow diagram and the route
// detail all use it, so a page can be followed by eye from one to the other.
// One accent and steps of grey, so a page can still be followed by eye without a rainbow.
const PALETTE = ["#ededed", "#ededed", "#b4b4ba", "#8b8b92", "#c6c6c6", "#6e6e74", "#d4d4d8", "#55555b"];

export const NEUTRAL_COLOR = "#52525b";

export function pageColor(page: string): string {
  let hash = 5381;
  for (let i = 0; i < page.length; i += 1) hash = ((hash << 5) + hash + page.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

/** A path shortened for tight spaces, keeping the end, which is the informative part. */
export function shortPath(path: string, max = 18): string {
  if (path.length <= max) return path;
  return `…${path.slice(path.length - (max - 1))}`;
}
