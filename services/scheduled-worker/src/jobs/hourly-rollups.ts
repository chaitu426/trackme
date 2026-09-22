import { getClickHouseClient } from "@trackme/analytics";

/**
 * Computes hourly rollups from events_raw into pageview_rollups_hourly
 */
export async function runHourlyRollups(): Promise<void> {
  const client = getClickHouseClient();

  console.log("⏰ Running hourly rollup aggregation...");

  const query = `
    INSERT INTO pageview_rollups_hourly (
      workspace_id, site_id, hour_timestamp, path, referrer, country, browser,
      device, campaign_source, campaign_medium, campaign_name,
      pageviews, unique_visitors, unique_sessions
    )
    SELECT
      workspace_id,
      site_id,
      toStartOfHour(timestamp) AS hour_timestamp,
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
    WHERE timestamp >= now() - INTERVAL 2 HOUR
      AND bot_status = 'human'
    GROUP BY
      workspace_id,
      site_id,
      hour_timestamp,
      path,
      referrer,
      country,
      browser,
      device,
      campaign_source,
      campaign_medium,
      campaign_name
  `;

  await client.command({ query });
  console.log("✅ Hourly rollup completed successfully.");
}

