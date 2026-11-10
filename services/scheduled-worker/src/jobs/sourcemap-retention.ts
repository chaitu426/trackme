import { createObjectStore, type ObjectStore } from "@trackme/object-store";

/** Source maps are only useful while errors from their release are still being looked at. Error occurrences keep 30 days; maps keep 90. */
export const SOURCEMAP_RETENTION_DAYS = 90;
const PREFIX = "sourcemaps";

/**
 * Deletes source maps older than the retention window. One listing of the sourcemaps prefix, then deletes; an upload
 * of the same file resets its age, so a release still being deployed is never cut. Returns how many were removed.
 */
export async function runSourceMapRetention(
  store: ObjectStore = createObjectStore(),
  now: Date = new Date()
): Promise<number> {
  const cutoff = now.getTime() - SOURCEMAP_RETENTION_DAYS * 86_400_000;
  let removed = 0;
  for (const object of await store.list(PREFIX)) {
    if (object.modifiedAt.getTime() < cutoff) {
      await store.delete(object.key);
      removed += 1;
    }
  }
  return removed;
}
