import { scrubErrorPayload, type EnrichedEvent, type ErrorPayload } from "@trackme/contracts";
import { errorTitle, groupId } from "./fingerprint.js";
import { toClickHouseDateTime64 } from "../writers/clickhouse.js";

/** One row for error_ingest; the view hashes the ids (migration 016). */
export interface ErrorIngestRow {
  workspace_id: string;
  site_id: string;
  group_id: string;
  ts: string;
  release: string;
  environment: string;
  level: string;
  session_id: string;
  visitor_pseudonym: string;
  user_id: string;
  title: string;
  etype: string;
  browser: string;
  country: string;
}

/** A candidate for the sampled detail table; the writer decides whether today's quota for the group is spent. */
export interface ErrorOccurrence {
  workspace_id: string;
  site_id: string;
  group_id: string;
  ts: string;
  event_id: string;
  release: string;
  environment: string;
  session_id: string;
  user_id: string;
  path: string;
  browser: string;
  os: string;
  stack: string;
  breadcrumbs: string;
  tags: string;
}

export interface PreparedErrors {
  /** The batch with each human error event's `properties` set to its group, ready for the normal event insert. */
  events: EnrichedEvent[];
  rows: ErrorIngestRow[];
  occurrences: ErrorOccurrence[];
}

/**
 * Scrubs and groups the error events in a batch. Everything else passes through untouched. Bots keep their
 * event (it is excluded from the aggregates by bot_status) but get no error row, like every other aggregate.
 * Scrubbing happens here even though the SDK already scrubbed: an old or modified client cannot be trusted.
 */
export function prepareErrorEvents(batch: EnrichedEvent[]): PreparedErrors {
  const events: EnrichedEvent[] = [];
  const rows: ErrorIngestRow[] = [];
  const occurrences: ErrorOccurrence[] = [];

  for (const event of batch) {
    if (event.type !== "error" || !event.error || event.botStatus !== "human") {
      events.push(event);
      continue;
    }

    const error: ErrorPayload = scrubErrorPayload(event.error);
    const gid = groupId(event.siteId, error);
    const level = error.level ?? "error";
    const release = event.release ?? "";
    const environment = event.environment ?? "production";
    const userId = event.userId ?? "";

    // The event's own properties are replaced by what identifies the issue. The user id stays, so per-user reports
    // (retention, the user timeline) can attribute the error; the title lets a timeline row say what happened.
    events.push({
      ...event,
      properties: {
        groupId: gid,
        errorType: error.type,
        level,
        title: errorTitle(error),
        ...(userId ? { distinctId: userId } : {}),
      },
    });

    rows.push({
      workspace_id: event.workspaceId,
      site_id: event.siteId,
      group_id: gid,
      ts: toClickHouseDateTime64(event.occurredAt),
      release,
      environment,
      level,
      session_id: event.sessionId,
      visitor_pseudonym: event.visitorPseudonym,
      user_id: userId,
      title: errorTitle(error),
      etype: error.type,
      browser: event.browser ?? "",
      country: event.country && event.country.length === 2 ? event.country.toUpperCase() : "",
    });

    occurrences.push({
      workspace_id: event.workspaceId,
      site_id: event.siteId,
      group_id: gid,
      ts: toClickHouseDateTime64(event.occurredAt),
      event_id: event.eventId,
      release,
      environment,
      session_id: event.sessionId,
      user_id: userId,
      path: event.path,
      browser: event.browser ?? "",
      os: event.os ?? "",
      stack: JSON.stringify(error.frames ?? []),
      breadcrumbs: JSON.stringify(error.breadcrumbs ?? []),
      tags: JSON.stringify(error.tags ?? {}),
    });
  }

  return { events, rows, occurrences };
}
