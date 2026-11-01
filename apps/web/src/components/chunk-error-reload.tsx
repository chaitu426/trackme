"use client";

import { useEffect } from "react";

const RELOAD_KEY = "trackme:chunk-reload-at";
const RELOAD_COOLDOWN_MS = 10_000;

function isChunkError(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false;
  const { name, message } = reason as { name?: unknown; message?: unknown };
  return (
    name === "ChunkLoadError" ||
    (typeof message === "string" && /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module/i.test(message))
  );
}

/**
 * After a deploy (or a rebuild under a running server) an open tab still points at
 * chunk files that no longer exist, and the next navigation throws ChunkLoadError.
 * Reloading once fetches the new build. The cooldown stops a reload loop if the
 * chunk is genuinely unreachable (offline, CDN down).
 */
export function ChunkErrorReload() {
  useEffect(() => {
    function recover(reason: unknown) {
      if (!isChunkError(reason)) return;
      try {
        const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
        if (Date.now() - last < RELOAD_COOLDOWN_MS) return;
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        // storage blocked: reload anyway, once per page load is bounded by the browser
      }
      window.location.reload();
    }
    const onError = (event: ErrorEvent) => recover(event.error ?? { message: event.message });
    const onRejection = (event: PromiseRejectionEvent) => recover(event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
