/**
 * Optional features (web vitals, error capture) ship as separate files so a page that does not use them
 * never downloads or parses them. In the standalone <script> build each is a classic script served next to
 * tracker.js; in the npm build they are ordinary dynamic imports and the bundler splits them.
 *
 * Both constants are replaced by the build (scripts/build-iife.mjs). Without them (unit tests) the npm path runs.
 */
declare const __CHUNKS__: Record<string, { f: string; i: string }>;

let loader: HTMLScriptElement | null = null;

/** The tag that loaded tracker.js; chunks are fetched from beside it. */
export function rememberScript(element: HTMLScriptElement | null): void {
  loader = element;
}

/**
 * Loads one chunk and resolves with what it exported, or null when it cannot be loaded (blocked, offline,
 * a proxy that does not forward it). A missing chunk costs that feature, never the page or the rest of the SDK.
 * A chunk hands over its API on its own script element, which avoids a global.
 */
export function loadChunk<T>(name: string): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const chunk = typeof __CHUNKS__ !== "undefined" ? __CHUNKS__[name] : undefined;
      if (!chunk || !loader?.src) return resolve(null);
      const script = document.createElement("script") as HTMLScriptElement & { _gi?: T };
      script.src = new URL(chunk.f, loader.src).href;
      // Pin the chunk the same way the page pinned tracker.js: only when the page used Subresource Integrity.
      if (loader.integrity) {
        script.integrity = chunk.i;
        script.crossOrigin = "anonymous";
      }
      script.async = true;
      script.onload = () => resolve(script._gi ?? null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    } catch {
      resolve(null);
    }
  });
}
