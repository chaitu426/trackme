import { createClient, ClickHouseClient } from "@clickhouse/client";
import { env } from "@trackme/config";

let clickhouseInstance: ClickHouseClient | null = null;

/**
 * Get or create ClickHouse client singleton
 */
export function getClickHouseClient(): ClickHouseClient {
  if (!clickhouseInstance) {
    clickhouseInstance = createClient({
      url: env.CLICKHOUSE_URL,
      username: env.CLICKHOUSE_USER,
      password: env.CLICKHOUSE_PASSWORD,
      database: env.CLICKHOUSE_DB,
      request_timeout: 30_000,
      max_open_connections: 50,
      compression: {
        response: true,
        request: true,
      },
    });
  }
  return clickhouseInstance;
}

export const clickhouse = getClickHouseClient();

