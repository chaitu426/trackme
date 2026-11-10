/**
 * Events for the alert engine (Phase 4). Nothing consumes them yet; they are published now so history starts accumulating and the
 * engine can be added without touching the places that detect things. Each is one entry on the Redis stream `alerts:events`
 * (about the last 10,000 kept). The stream carries identifiers and titles, never stack traces, user data or payment details.
 */
export const ALERT_STREAM = "alerts:events";

export interface AlertEvent {
  type: "new_error_group" | "error_regression";
  siteId: string;
  groupId: string;
  title?: string;
  release?: string;
  level?: string;
  at: string;
}

export interface StreamWriter {
  xadd(key: string, ...rest: Array<string | number>): Promise<unknown>;
}

export async function publishAlertEvent(redis: StreamWriter, event: AlertEvent): Promise<void> {
  const fields: string[] = [];
  for (const [k, v] of Object.entries(event)) if (typeof v === "string" && v !== "") fields.push(k, v);
  await redis.xadd(ALERT_STREAM, "MAXLEN", "~", 10000, "*", ...fields);
}
