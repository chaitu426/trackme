import { Redis } from "ioredis";
import { env } from "@trackme/config";
import { getRealtimeSnapshot, type RealtimeSnapshot } from "./realtime.js";

type SnapshotListener = (snapshot: RealtimeSnapshot) => void;

type SiteHub = {
  listeners: Set<SnapshotListener>;
  lastSnapshot: RealtimeSnapshot;
  lastJson: string;
  fallbackTimer: ReturnType<typeof setInterval> | null;
  refreshing: boolean;
};

const hubs = new Map<string, SiteHub>();
let subClient: Redis | null = null;
const CHANNEL_PREFIX = "rt:notify:";

function ensurePubSub(): void {
  if (subClient) return;
  subClient = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  void subClient.psubscribe(`${CHANNEL_PREFIX}*`);
  subClient.on("pmessage", (_pattern, channel) => {
    if (!channel.startsWith(CHANNEL_PREFIX)) return;
    const siteId = channel.slice(CHANNEL_PREFIX.length);
    if (hubs.has(siteId)) {
      void refreshSite(siteId);
    }
  });
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
  } finally {
    hub.refreshing = false;
  }
}

/**
 * Process-level fan-out: one Redis read (+ pub/sub wake) serves all SSE
 * clients watching the same site. Fallback poll handles TTL expiry when
 * no new events arrive.
 */
export function subscribeSiteRealtime(
  siteId: string,
  listener: SnapshotListener
): () => void {
  ensurePubSub();

  let hub = hubs.get(siteId);
  if (!hub) {
    hub = {
      listeners: new Set(),
      lastSnapshot: { activeVisitors: 0, pages: [] },
      lastJson: "",
      fallbackTimer: null,
      refreshing: false,
    };
    hubs.set(siteId, hub);
    hub.fallbackTimer = setInterval(() => {
      void refreshSite(siteId);
    }, 5_000);
    void refreshSite(siteId);
  }

  hub.listeners.add(listener);
  listener(hub.lastSnapshot);

  return () => {
    const current = hubs.get(siteId);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      if (current.fallbackTimer) clearInterval(current.fallbackTimer);
      hubs.delete(siteId);
    }
  };
}
