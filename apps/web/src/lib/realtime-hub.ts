import { Redis } from "ioredis";
import { getRedisURLForRole } from "@trackme/config";
import { getRealtimeSnapshot, type RealtimeSnapshot } from "./realtime.js";

type SnapshotListener = (snapshot: RealtimeSnapshot) => void;

type SiteHub = {
  listeners: Set<SnapshotListener>;
  lastSnapshot: RealtimeSnapshot;
  lastJson: string;
  fallbackTimer: ReturnType<typeof setTimeout> | null;
  refreshing: boolean;
};

/** Upper bound of SSE listeners per site per node; protects the node from one hot site. */
export const MAX_LISTENERS_PER_SITE = 200;
const FALLBACK_INTERVAL_MS = 5_000;
const FALLBACK_JITTER = 0.2;

/** Next fallback delay: base +/- 20 % so hubs do not poll in the same tick. */
export function jitteredDelay(baseMs: number, random: () => number = Math.random): number {
  return Math.round(baseMs * (1 + (random() * 2 - 1) * FALLBACK_JITTER));
}

const hubs = new Map<string, SiteHub>();
let subClient: Redis | null = null;
const CHANNEL_PREFIX = "rt:notify:";

/**
 * One shared subscriber connection. Channels are subscribed per site when the
 * first listener arrives and released with the last one, so a node only receives
 * notifications for sites someone on it is watching. ioredis re-subscribes the
 * active channels on reconnect.
 */
function getSubscriber(): Redis {
  if (subClient) return subClient;
  subClient = new Redis(getRedisURLForRole("coord"), {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  subClient.on("message", (channel) => {
    if (!channel.startsWith(CHANNEL_PREFIX)) return;
    const siteId = channel.slice(CHANNEL_PREFIX.length);
    if (hubs.has(siteId)) {
      void refreshSite(siteId);
    }
  });
  subClient.on("error", () => {
    // reconnect is automatic; the fallback poll covers the gap
  });
  return subClient;
}

function scheduleFallback(siteId: string): void {
  const hub = hubs.get(siteId);
  if (!hub) return;
  hub.fallbackTimer = setTimeout(() => {
    void refreshSite(siteId).finally(() => scheduleFallback(siteId));
  }, jitteredDelay(FALLBACK_INTERVAL_MS));
}

async function refreshSite(siteId: string): Promise<void> {
  const hub = hubs.get(siteId);
  if (!hub || hub.refreshing) return;
  hub.refreshing = true;
  try {
    const snapshot = await getRealtimeSnapshot(siteId);
    const json = JSON.stringify(snapshot);
    if (json === hub.lastJson) return;
    hub.lastJson = json;
    hub.lastSnapshot = snapshot;
    for (const listener of hub.listeners) {
      try {
        listener(snapshot);
      } catch {
        // listener errors shouldn't kill the hub
      }
    }
  } catch {
    // keep the last snapshot; the next notify or fallback tick retries
  } finally {
    hub.refreshing = false;
  }
}

/**
 * Process-level fan-out: one Redis read (+ pub/sub wake) serves all SSE
 * clients watching the same site. Fallback poll handles TTL expiry when
 * no new events arrive.
 *
 * Returns null when the site already has MAX_LISTENERS_PER_SITE listeners on
 * this node; the caller should answer 429 so the client retries elsewhere.
 */
export function subscribeSiteRealtime(
  siteId: string,
  listener: SnapshotListener
): (() => void) | null {
  let hub = hubs.get(siteId);
  if (hub && hub.listeners.size >= MAX_LISTENERS_PER_SITE) return null;

  if (!hub) {
    hub = {
      listeners: new Set(),
      lastSnapshot: { activeVisitors: 0, pages: [] },
      lastJson: "",
      fallbackTimer: null,
      refreshing: false,
    };
    hubs.set(siteId, hub);
    void getSubscriber().subscribe(`${CHANNEL_PREFIX}${siteId}`).catch(() => {
      // the jittered fallback poll keeps the stream live without pub/sub
    });
    scheduleFallback(siteId);
    void refreshSite(siteId);
  }

  hub.listeners.add(listener);
  listener(hub.lastSnapshot);

  return () => {
    const current = hubs.get(siteId);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      if (current.fallbackTimer) clearTimeout(current.fallbackTimer);
      hubs.delete(siteId);
      void subClient?.unsubscribe(`${CHANNEL_PREFIX}${siteId}`).catch(() => undefined);
    }
  };
}
