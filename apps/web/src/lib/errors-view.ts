import { createHash } from "node:crypto";
import {
  getErrorFilterOptions,
  getErrorGroup,
  getErrorReleaseBreakdown,
  getErrorTrends,
  getOccurrences,
  getTagBreakdown,
  listErrorGroups,
  type ErrorListQuery,
} from "@trackme/analytics";
import { cached } from "@/lib/query-cache";

/* Short-lived result cache: identical dashboard loads share one ClickHouse query (single flight, stale while
   revalidate, early refresh: see cached() in query-cache). Reads are by site, so keys carry the site id. Callers
   must authorize the site first. 30 s: error counts are live numbers, and a status change alters the key. */
const TTL_SECONDS = 30;
const key = (kind: string, siteId: string, input: unknown) =>
  `q:v1:err:${kind}:${siteId}:${createHash("sha1").update(JSON.stringify(input)).digest("hex")}`;

export const cachedErrorList = (query: ErrorListQuery) =>
  cached(key("list", query.siteId, query), TTL_SECONDS, () => listErrorGroups(query));

export const cachedErrorTrends = (siteId: string, groupIds: string[], from: string, to: string) =>
  cached(key("trend", siteId, [groupIds, from, to]), TTL_SECONDS, () => getErrorTrends(siteId, groupIds, from, to));

export const cachedErrorOptions = (siteId: string, from: string, to: string) =>
  cached(key("opts", siteId, [from, to]), 300, () => getErrorFilterOptions(siteId, from, to));

export const cachedErrorGroup = (siteId: string, groupId: string) =>
  cached(key("group", siteId, groupId), TTL_SECONDS, () => getErrorGroup(siteId, groupId));

export const cachedErrorBreakdown = (siteId: string, groupId: string, from: string, to: string) =>
  cached(key("rel", siteId, [groupId, from, to]), TTL_SECONDS, () => getErrorReleaseBreakdown(siteId, groupId, from, to));

export const cachedOccurrences = (workspaceId: string, siteId: string, groupId: string) =>
  cached(key("occ", siteId, [workspaceId, groupId]), TTL_SECONDS, () => getOccurrences(workspaceId, siteId, groupId, 20));

export const cachedTags = (workspaceId: string, siteId: string, groupId: string) =>
  cached(key("tags", siteId, [workspaceId, groupId]), TTL_SECONDS, () => getTagBreakdown(workspaceId, siteId, groupId));
