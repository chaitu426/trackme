import { env } from "@trackme/config";

export function resolveTrackerScriptUrl(version: "v1" | "latest" = "v1"): string {
  const base = (env.TRACKER_CDN_URL || env.APP_URL).replace(/\/+$/, "");
  if (version === "latest") {
    return `${base}/tracker.js`;
  }
  return `${base}/t/v1/tracker.js`;
}
