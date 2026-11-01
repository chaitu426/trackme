/**
 * What counts as an engaged session, defined once so the overview, the time series and the
 * daily rollups cannot drift apart.
 *
 * A session is engaged when it viewed two or more pages, stayed active for at least
 * ENGAGED_SECONDS, or did something on purpose (a custom event). Everything else is a bounce.
 * This is the GA4 definition. The old rule (exactly one pageview) called a visitor who read
 * one page for ten minutes a bounce.
 *
 * Active time comes from the tracker's `engagement` events, which carry the milliseconds a
 * page was visible and in use. A session from an older tracker has none, so its duration
 * falls back to last event minus first event.
 */

/** Events the tracker records by itself. They say what a visitor did, not that they meant to. */
export const AUTO_EVENT_NAMES = ["scroll_depth", "outbound_click", "file_download"] as const;

export const ENGAGED_SECONDS = 10;

const autoList = AUTO_EVENT_NAMES.map((n) => `'${n}'`).join(", ");

/** Per-session columns. Select these inside a `GROUP BY session` subquery. */
export const SESSION_ENGAGEMENT_COLUMNS = `
  countIf(type = 'pageview') AS pageview_count,
  sumIf(JSONExtractUInt(properties_json, 'engagementMs'), type = 'engagement') AS engaged_ms,
  countIf(type = 'custom' AND event_name NOT IN (${autoList})) AS action_count,
  dateDiff('second', min(timestamp), max(timestamp)) AS span_seconds`;

/** Boolean expression over the columns above (or the per-session aggregate columns). */
export const SESSION_ENGAGED_SQL = `(pageview_count >= 2 OR engaged_ms >= ${ENGAGED_SECONDS * 1000} OR action_count > 0)`;

/** Seconds a session was active. */
export const SESSION_DURATION_SQL = `if(engaged_ms > 0, toInt64(intDiv(engaged_ms, 1000)), toInt64(span_seconds))`;
