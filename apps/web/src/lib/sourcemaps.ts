import { createHash } from "node:crypto";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { createObjectStore, type ObjectStore } from "@trackme/object-store";

/** Biggest source map accepted. Bundles of a few MB produce maps of a few MB; anything past this is almost certainly a mistake. */
export const MAX_MAP_BYTES = 10 * 1024 * 1024;
export const SOURCEMAP_PREFIX = "sourcemaps";

const sha = (text: string, length: number) => createHash("sha256").update(text).digest("hex").slice(0, length);

/**
 * `https://cdn.test/assets/app.3f2a.js?v=1` and `/assets/app.3f2a.js` are the same file. Maps are looked up by path
 * only: the host differs between environments, and the release in the key already says which build it is.
 */
export function normalizeFileKey(file: string): string {
  let pathname = file.trim();
  try {
    pathname = new URL(file).pathname;
  } catch {
    pathname = pathname.split(/[?#]/)[0] ?? pathname;
  }
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

/** Tenant first: every key starts with the site id, so listing or deleting a site's maps is a prefix operation. */
export function mapKey(siteId: string, release: string, file: string): string {
  return `${SOURCEMAP_PREFIX}/${siteId}/${sha(release, 16)}/${sha(normalizeFileKey(file), 32)}.map`;
}

export type MapCheck = { ok: true; map: RawSourceMap } | { ok: false; reason: string };

/** A source map is JSON with version 3, a `mappings` string and a `sources` list. Anything else is refused at upload. */
export function checkSourceMap(text: string): MapCheck {
  if (text.length > MAX_MAP_BYTES) return { ok: false, reason: "The source map is larger than 10 MB" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "The source map is not valid JSON" };
  }
  const map = parsed as Partial<RawSourceMap> | null;
  if (!map || typeof map !== "object" || Number(map.version) !== 3 || typeof map.mappings !== "string" || !Array.isArray(map.sources)) {
    return { ok: false, reason: "Not a version 3 source map (needs version, sources and mappings)" };
  }
  return { ok: true, map: map as RawSourceMap };
}

/** `webpack://app/./src/pay.ts` and `/abs/build/../src/pay.ts` read as `src/pay.ts`. */
export function cleanSource(source: string): string {
  return source
    .replace(/^(?:webpack|webpack-internal|vite|rollup|ng):\/\/[^/]*\//, "")
    .replace(/^\.\//, "")
    .replace(/^file:\/\//, "")
    .replace(/\?.*$/, "");
}

export interface Frame {
  fn?: string;
  file: string;
  line?: number;
  col?: number;
  inApp?: boolean;
}

/** Small cache of parsed maps: parsing a multi-MB map takes tens of milliseconds and a page shows ≤ 50 frames from one or two files. */
const MAX_CACHED = 16;
const parsed = new Map<string, Promise<SourceMapConsumer | null>>();

function consumerFor(store: ObjectStore, key: string): Promise<SourceMapConsumer | null> {
  const hit = parsed.get(key);
  if (hit) {
    parsed.delete(key);
    parsed.set(key, hit); // most recently used last
    return hit;
  }
  const loading = (async () => {
    const bytes = await store.get(key);
    if (!bytes) return null;
    const check = checkSourceMap(new TextDecoder().decode(bytes));
    return check.ok ? new SourceMapConsumer(check.map) : null;
  })().catch(() => null);
  parsed.set(key, loading);
  if (parsed.size > MAX_CACHED) parsed.delete(parsed.keys().next().value as string);
  return loading;
}

export function clearSourceMapCache(): void {
  parsed.clear();
}

/**
 * Replaces minified frames with the original file, line and column, and recovers function names, where a map for that
 * release and file exists. A frame without a map, or that the map cannot place, is returned as it was, so a missing or
 * wrong map degrades to the raw trace rather than breaking the page.
 *
 * Function names: a map's `name` at a position is the identifier used THERE (the function being called), not the
 * function that contains the position. So frame i is named after what the frame above it (its caller, i+1) calls:
 * `r` in frame 0 becomes `validateCart` because frame 1 sits on the call `validateCart(cart)`. When the caller has no
 * map the reported name is kept.
 */
export async function symbolicate(
  siteId: string,
  release: string,
  frames: Frame[],
  store: ObjectStore = createObjectStore()
): Promise<{ frames: Frame[]; mapped: number }> {
  if (!release) return { frames, mapped: 0 };

  type Placed = { source: string; line: number; col: number | null; name: string | null | undefined };
  const placed: Array<Placed | null> = [];
  for (const frame of frames) {
    try {
      if (frame.line === undefined) {
        placed.push(null);
        continue;
      }
      const consumer = await consumerFor(store, mapKey(siteId, release, frame.file));
      // Stack columns count from 1, source maps from 0.
      const original = consumer?.originalPositionFor({ line: frame.line, column: Math.max(0, (frame.col ?? 1) - 1) });
      placed.push(
        original?.source && original.line !== null
          ? { source: cleanSource(original.source), line: original.line, col: original.column, name: original.name }
          : null
      );
    } catch {
      placed.push(null);
    }
  }

  let mapped = 0;
  const out = frames.map((frame, i): Frame => {
    const here = placed[i];
    if (!here) return frame;
    mapped += 1;
    const fn = placed[i + 1]?.name ?? frame.fn;
    return {
      ...(fn ? { fn } : {}),
      file: here.source,
      line: here.line,
      ...(here.col !== null ? { col: here.col + 1 } : {}),
      inApp: !here.source.includes("node_modules"),
    };
  });
  return { frames: out, mapped };
}

let shared: ObjectStore | null = null;
export const getObjectStore = (): ObjectStore => (shared ??= createObjectStore());
