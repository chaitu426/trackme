import type { EventProperties, TrackerEvent } from "@trackme/contracts";

// The ingestion edge rejects a whole event that breaks one of these, and the SDK never hears
// about it (the request still succeeds). Fitting the event here keeps it instead.
const MAX_URL = 2048;
const MAX_PATH = 512;
const MAX_TITLE = 512;
const MAX_CAMPAIGN_VALUE = 128;
const MAX_PROPS = 50;
const MAX_PROP_KEY = 64;
const MAX_PROP_VALUE = 256;
const PROP_KEY = /^[a-zA-Z0-9_.-]+$/;

const warned = new Set<string>();

/** One console line per distinct problem, so a loop of bad events cannot flood the console. */
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[trackme] ${message}`);
}

const cut = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text);

/** Properties the contract can hold: scalars under valid keys. Anything else is dropped, not the event. */
export function limitProperties(properties: EventProperties | undefined, where: string): EventProperties | undefined {
  if (!properties) return properties;
  const out: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
    if (value === undefined) continue;
    const validKey = key.length > 0 && key.length <= MAX_PROP_KEY && PROP_KEY.test(key);
    const scalar =
      typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
    if (!validKey || !scalar || count >= MAX_PROPS) {
      warnOnce(`${where}: "${key.slice(0, 32)}" dropped (keys: letters, digits _ . -; values: string, number, boolean; max ${MAX_PROPS})`);
      continue;
    }
    out[key] = typeof value === "string" ? cut(value, MAX_PROP_VALUE) : value;
    count += 1;
  }
  return out as EventProperties;
}

function limitUrl(value: string): string {
  if (value.length <= MAX_URL) return value;
  try {
    const url = new URL(value);
    return cut(`${url.origin}${url.pathname}`, MAX_URL);
  } catch {
    return cut(value, MAX_URL);
  }
}

function limitPath(value: string): string {
  if (value.length <= MAX_PATH) return value;
  // A long query is what makes a path long; the page is still identified by its pathname.
  const withoutQuery = value.split("?")[0] ?? value;
  return cut(withoutQuery, MAX_PATH);
}

/** Fits an event to the edge's limits without discarding it. */
export function limitEvent(event: TrackerEvent): TrackerEvent {
  const next: TrackerEvent = { ...event };
  next.url = limitUrl(next.url);
  next.path = limitPath(next.path);
  if (next.title) next.title = cut(next.title, MAX_TITLE);
  if (next.referrer) next.referrer = limitUrl(next.referrer);
  if (next.campaign) {
    const campaign: Record<string, string> = {};
    for (const [key, value] of Object.entries(next.campaign as Record<string, string | undefined>)) {
      if (value) campaign[key] = cut(value, MAX_CAMPAIGN_VALUE);
    }
    next.campaign = campaign as TrackerEvent["campaign"];
  }
  if (next.properties) next.properties = limitProperties(next.properties, "event properties");
  if (next.userTraits) next.userTraits = limitProperties(next.userTraits, "identify traits");
  return next;
}
