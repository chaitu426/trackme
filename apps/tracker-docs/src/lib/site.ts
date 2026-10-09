/**
 * Placeholders that appear in every code sample. Readers can replace them with
 * their own values from the "Your setup" menu in the header, and every snippet on
 * every page updates (see components/token-sync.tsx).
 */
export const PLACEHOLDERS = {
  siteKey: "YOUR_SITE_KEY",
  scriptUrl: "https://app.example.com/tracker.js",
  ingestUrl: "https://ingest.example.com/v1/batch",
} as const;

export type PlaceholderKey = keyof typeof PLACEHOLDERS;

export const STORAGE_KEY = "trackme_docs_setup";

/** Where the dashboard lives, for the header link. Optional. */
export const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "";

export const PRODUCT = "TrackMe";
