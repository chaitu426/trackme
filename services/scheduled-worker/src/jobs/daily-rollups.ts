import { getClickHouseClient } from "@trackme/analytics";

/**
 * Computes daily rollups into pageview_rollups_daily and event_rollups_daily
 */
export async function runDailyRollups(): Promise<void> {
  const client = getClickHouseClient();

  console.log("⏰ Running daily rollup aggregation...");

  // Daily pageviews
  await client.command({
    query: `
      INSERT INTO pageview_rollups_daily (
        workspace_id, site_id, date, path, referrer, country, browser,
        device, campaign_source, campaign_medium, campaign_name,
        pageviews, unique_visitors, unique_sessions
      )
      SELECT
        workspace_id,
        site_id,
        toDate(timestamp) AS date,
        path,
        referrer,
        country,
        browser,
        device,
        campaign_source,
        campaign_medium,
        campaign_name,
        countIf(type = 'pageview') AS pageviews,
        uniqExact(visitor_pseudonym) AS unique_visitors,
        uniqExact(session_id) AS unique_sessions
      FROM events_raw
      WHERE timestamp >= today() - INTERVAL 1 DAY
        AND bot_status = 'human'
      GROUP BY
        workspace_id,
        site_id,
        date,
        path,
        referrer,
        country,
        browser,
        device,
        campaign_source,
        campaign_medium,
        campaign_name
    `,
  });

  // Daily custom events
  await client.command({
    query: `
      INSERT INTO event_rollups_daily (
        workspace_id, site_id, date, event_name,
        total_count, unique_sessions, unique_visitors
      )
      SELECT
        workspace_id,
        site_id,
        toDate(timestamp) AS date,
        event_name,
        count(*) AS total_count,
        uniqExact(session_id) AS unique_sessions,
        uniqExact(visitor_pseudonym) AS unique_visitors
      FROM events_raw
      WHERE timestamp >= today() - INTERVAL 1 DAY
        AND type = 'custom'
        AND bot_status = 'human'
      GROUP BY
        workspace_id,
        site_id,
        date,
        event_name
    `,
  });

  // Session engagement (bounce + duration) — attribute to session-start day.
  // 2-day lookback so late events recompute yesterday via ReplacingMergeTree.
  await client.command({
    query: `
      INSERT INTO session_engagement_daily (
        workspace_id, site_id, date,
        sessions, bounced_sessions, total_duration_seconds, pageviews
      )
      SELECT
        workspace_id,
        site_id,
        toDate(session_start) AS date,
        count() AS sessions,
        countIf(pageview_count = 1) AS bounced_sessions,
        sum(duration_seconds) AS total_duration_seconds,
        sum(pageview_count) AS pageviews
      FROM (
        SELECT
          workspace_id,
          site_id,
          session_id,
          min(timestamp) AS session_start,
          dateDiff('second', min(timestamp), max(timestamp)) AS duration_seconds,
          countIf(type = 'pageview') AS pageview_count
        FROM events_raw
        WHERE timestamp >= today() - INTERVAL 2 DAY
          AND bot_status = 'human'
        GROUP BY workspace_id, site_id, session_id
      )
      WHERE toDate(session_start) >= today() - INTERVAL 1 DAY
      GROUP BY workspace_id, site_id, date
    `,
  });

  console.log("✅ Daily rollups completed successfully.");
}

