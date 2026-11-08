import { readFileSync } from "node:fs";
import path from "node:path";
import { env } from "@trackme/config";

/**
 * Where customers load the tracker from, and how to pin it.
 *
 * The tracker runs on every page of every customer's site, so whatever this server serves at the URL they paste
 * is code on their site. Two things limit that risk:
 *  - Snippets point at an immutable, content-hashed file (/t/<version>/tracker.<version>.<hash>.js) instead of a
 *    mutable alias such as /tracker.js, so the URL itself names exact bytes.
 *  - Snippets carry that file's Subresource Integrity hash (integrity="sha384-..."), so the browser refuses to run
 *    anything else even if this server, or the path, were compromised.
 * The mutable aliases (/tracker.js, /t/v1/tracker.js) still exist for installs that predate this.
 */
interface PinnedTracker {
  version: string;
  path: string;
  integrity: string;
}

let cached: PinnedTracker | null | undefined;

/** Written by scripts/copy-tracker-assets.mjs at build time. Null when the build has not produced it. */
function pinned(): PinnedTracker | null {
  if (cached !== undefined) return cached;
  try {
    const raw = JSON.parse(readFileSync(path.join(process.cwd(), "public", "t", "manifest.json"), "utf8")) as Partial<PinnedTracker>;
    cached =
      typeof raw.path === "string" && raw.path.startsWith("/t/") && typeof raw.integrity === "string" && raw.integrity.startsWith("sha384-")
        ? { version: String(raw.version), path: raw.path, integrity: raw.integrity }
        : null;
  } catch {
    cached = null;
  }
  return cached;
}

const base = () => (env.TRACKER_CDN_URL || env.APP_URL).replace(/\/+$/, "");

export function resolveTrackerScriptUrl(version: "pinned" | "v1" | "latest" = "pinned"): string {
  if (version === "latest") return `${base()}/tracker.js`;
  if (version === "v1") return `${base()}/t/v1/tracker.js`;
  const p = pinned();
  return p ? `${base()}${p.path}` : `${base()}/t/v1/tracker.js`;
}

/** The SRI hash for the pinned file, or null when there is none (then the snippet simply omits it). */
export function resolveTrackerIntegrity(): string | null {
  return pinned()?.integrity ?? null;
}

/** ` integrity="..." crossorigin="anonymous"` for an HTML script tag, or "" when there is no hash. */
export function trackerIntegrityAttrs(): string {
  const integrity = resolveTrackerIntegrity();
  return integrity ? ` integrity="${integrity}" crossorigin="anonymous"` : "";
}
