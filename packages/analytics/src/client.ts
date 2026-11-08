import fs from "node:fs";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import { env } from "@trackme/config";
import { createTenantGate, tenantOf } from "./tenant-gate.js";

let clickhouseInstance: ClickHouseClient | null = null;

/** Trust a private server CA (managed ClickHouse) when CLICKHOUSE_CA_CERT_PATH is set. */
function clickHouseTls(): { tls?: { ca_cert: Buffer } } {
  return env.CLICKHOUSE_CA_CERT_PATH ? { tls: { ca_cert: fs.readFileSync(env.CLICKHOUSE_CA_CERT_PATH) } } : {};
}

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
      ...clickHouseTls(),
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

export interface DashboardCredentials {
  username: string;
  password: string;
}

/**
 * Credentials for dashboard reads. Production must use the dedicated read-only
 * user so a bad or malicious query cannot write, and runs under the profile's
 * limits. Development falls back to the main user so a fresh checkout works.
 */
export function resolveDashboardCredentials(source: {
  NODE_ENV: string;
  CLICKHOUSE_USER: string;
  CLICKHOUSE_PASSWORD: string;
  CLICKHOUSE_DASHBOARD_USER?: string | undefined;
  CLICKHOUSE_DASHBOARD_PASSWORD?: string | undefined;
}): DashboardCredentials {
  const username = source.CLICKHOUSE_DASHBOARD_USER?.trim();
  if (username) {
    return { username, password: source.CLICKHOUSE_DASHBOARD_PASSWORD ?? "" };
  }
  if (source.NODE_ENV === "production") {
    throw new Error(
      "CLICKHOUSE_DASHBOARD_USER is required in production: dashboard queries must run as the read-only user (see infra/ops/clickhouse-dashboard-ro.sql)"
    );
  }
  return { username: source.CLICKHOUSE_USER, password: source.CLICKHOUSE_PASSWORD };
}

let dashboardInstance: ClickHouseClient | null = null;

const gate = createTenantGate(env.DASHBOARD_TENANT_CONCURRENCY, env.DASHBOARD_TENANT_QUEUE, 5_000);

/**
 * Every dashboard query goes through the per-workspace gate (tenant-gate.ts). `wait_end_of_query`
 * makes ClickHouse answer only once the query has finished, so the time spent inside the gate is the
 * time the query holds a server slot (without it the response starts streaming while the query is
 * still running and the slot would be released too early).
 */
function withTenantGate(client: ClickHouseClient): ClickHouseClient {
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop !== "query") return typeof value === "function" ? value.bind(target) : value;
      return (params: Parameters<ClickHouseClient["query"]>[0]) =>
        gate(tenantOf(params), () =>
          target.query({ ...params, clickhouse_settings: { wait_end_of_query: 1, ...params.clickhouse_settings } })
        );
    },
  });
}

/**
 * Client for dashboard (read) queries. Separate from getClickHouseClient so the
 * web app can run as a read-only user with per-query limits while the workers keep
 * their write user. A shorter timeout than the writer's: a dashboard request that
 * takes 15 s is already a failure.
 */
export function getDashboardClickHouseClient(): ClickHouseClient {
  if (!dashboardInstance) {
    const { username, password } = resolveDashboardCredentials(env);
    const raw = createClient({
      url: env.CLICKHOUSE_URL,
      username,
      password,
      database: env.CLICKHOUSE_DB,
      ...clickHouseTls(),
      request_timeout: 15_000,
      max_open_connections: 50,
      compression: { response: true },
    });
    dashboardInstance = withTenantGate(raw);
  }
  return dashboardInstance;
}

export const clickhouse = getClickHouseClient();

