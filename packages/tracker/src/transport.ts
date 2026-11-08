import { TrackerEvent } from "@trackme/contracts";

export interface TransportOptions {
  endpoint: string;
  /** Flush as soon as this many events are buffered. */
  batchSize?: number;
  /**
   * Minimum gap between requests. The first event after an idle period is sent
   * on the next tick; events arriving inside the window are batched until it ends.
   */
  flushIntervalMs?: number;
  /** HMAC secret for X-GI-Signature. Prefer first-party proxy over exposing in page HTML. */
  signingSecret?: string | undefined;
  /** Sent as X-GI-Consent. "denied" discards everything queued and ignores new events. */
  consent?: "granted" | "denied" | null;
  /** Keep persisted events untouched until consent is granted. */
  requireConsent?: boolean;
  /** Source of randomness for retry jitter; tests pin it. */
  random?: () => number;
}

const RETRY_QUEUE_KEY = "_gi_retry_queue";
const MAX_QUEUED_EVENTS = 100;

// Limits enforced by the ingestion edge. A request over either is rejected
// whole, so the SDK must split before sending, not after a rejection.
const MAX_EVENTS_PER_REQUEST = 50;
const MAX_BYTES_PER_REQUEST = 30_000; // edge body limit is 32 KB
const ENVELOPE_BYTES = 12; // {"events":[]}

// An event the edge keeps failing on is dropped rather than retried forever. Only answers
// from the edge count: being offline says nothing about the event, so it waits (until it is
// too old) instead of burning attempts.
const MAX_ATTEMPTS = 5;
// The edge replaces timestamps older than 24 h with receive time, so an event
// this old would be recorded at the wrong moment. Better to drop it.
const MAX_EVENT_AGE_MS = 23 * 60 * 60 * 1000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60 * 1000;
// Browsers cap in-flight keepalive bodies at 64 KB across the page.
const MAX_REQUESTS_ON_HIDE = 2;

type Entry = { event: TrackerEvent; attempts: number; json?: string };
type Outcome = "sent" | "retry" | "offline" | "drop";

/**
 * What a response status means for the events in the request.
 * Only failures that can clear up by themselves are retried.
 */
export function classifyStatus(status: number): Outcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  // 400 bad payload, 401 bad key or signature, 402 quota, 403 origin or
  // consent: resending the same bytes gets the same answer.
  return "drop";
}

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;
// Each event is serialized once (in takeChunk, to size the request) and reused here.
const bodyOf = (entries: Entry[]): string => `{"events":[${entries.map((e) => e.json).join(",")}]}`;

function readQueue(): Entry[] {
  try {
    const raw = window.localStorage.getItem(RETRY_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries: Entry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      if (obj.event && typeof obj.attempts === "number") {
        entries.push({ event: obj.event as TrackerEvent, attempts: obj.attempts });
      } else if (typeof obj.eventId === "string") {
        // Queue written by an earlier SDK version: bare events.
        entries.push({ event: item as TrackerEvent, attempts: 0 });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function writeQueue(entries: Entry[]): void {
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(RETRY_QUEUE_KEY);
      return;
    }
    window.localStorage.setItem(RETRY_QUEUE_KEY, JSON.stringify(entries.slice(-MAX_QUEUED_EVENTS)));
  } catch {
    // Best-effort only
  }
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class Transport {
  private buffer: Entry[] = [];
  private timer: number | null = null;
  private retryTimer: number | null = null;
  /** The edge asked us to stay quiet until then (X-GI-Backoff on any answer, Retry-After on 429/503). */
  private holdUntil = 0;
  private readonly endpoint: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly signingSecret: string | undefined;
  private readonly requireConsent: boolean;
  private readonly random: () => number;
  private consent: "granted" | "denied" | null;
  private running: Promise<void> | null = null;
  private flushAgain = false;
  private lastFlushAt = 0;
  private consecutiveFailures = 0;

  constructor(options: TransportOptions) {
    this.endpoint = options.endpoint;
    this.batchSize = options.batchSize ?? 5;
    this.flushIntervalMs = options.flushIntervalMs ?? 100;
    this.signingSecret = options.signingSecret;
    this.requireConsent = options.requireConsent ?? false;
    this.random = options.random ?? Math.random;
    this.consent = options.consent ?? null;

    if (typeof window === "undefined") return;

    if (this.consent === "denied") {
      writeQueue([]);
    } else {
      this.replayPersisted();
      if (this.buffer.length > 0) this.armTimer();
    }

    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.flushOnHide();
    });
    window.addEventListener("pagehide", () => this.flushOnHide());
    // Connectivity is back: retry now instead of waiting out a backoff set while offline.
    window.addEventListener("online", () => this.retryNow());
  }

  private retryNow(): void {
    if (this.consent === "denied") return;
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.consecutiveFailures = 0;
    this.replayPersisted();
    if (this.buffer.length > 0) void this.flush();
  }

  public setConsent(value: "granted" | "denied" | null): void {
    this.consent = value;
    if (value === "denied") {
      this.clear();
    } else if (value === "granted") {
      this.replayPersisted();
      if (this.buffer.length > 0) void this.flush();
    }
  }

  public enqueue(event: TrackerEvent): void {
    if (this.consent === "denied") return;
    this.buffer.push({ event, attempts: 0 });

    if (this.buffer.length >= this.batchSize) {
      void this.flush();
    } else {
      this.armTimer();
    }
  }

  /**
   * Send everything buffered, in requests that respect the edge's size limits.
   * A call made while a send is in flight is remembered and runs afterwards,
   * so events enqueued mid-request are never stranded in the buffer. The
   * returned promise settles when everything buffered at that point is done.
   */
  public flush(): Promise<void> {
    this.cancelTimer();
    this.lastFlushAt = Date.now();
    if (this.running) {
      this.flushAgain = true;
      return this.running;
    }
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain(): Promise<void> {
    do {
      this.flushAgain = false;
      while (this.buffer.length > 0 && this.consent !== "denied") {
        const chunk = this.takeChunk(this.buffer);
        if (chunk.length === 0) continue; // only oversized events were removed
        const outcome = await this.send(chunk);
        if (!this.applyOutcome(chunk, outcome)) break;
      }
    } while (this.flushAgain);
  }

  private armTimer(): void {
    if (this.timer !== null || typeof window === "undefined") return;
    // Leading edge: an idle transport sends on the next tick (still batching
    // events queued in the same tick); a busy one waits out the rest of the window.
    const wait = Math.max(0, this.lastFlushAt + this.flushIntervalMs - Date.now(), this.holdUntil - Date.now());
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Remove and return the next request's worth of entries. */
  private takeChunk(source: Entry[]): Entry[] {
    const chunk: Entry[] = [];
    let bytes = ENVELOPE_BYTES;
    while (source.length > 0 && chunk.length < MAX_EVENTS_PER_REQUEST) {
      const next = source[0] as Entry;
      next.json ??= JSON.stringify(next.event);
      const size = byteLength(next.json) + 1; // +1 for the comma
      if (size + ENVELOPE_BYTES > MAX_BYTES_PER_REQUEST) {
        source.shift(); // can never fit in one request; sending it would fail the whole batch
        continue;
      }
      if (bytes + size > MAX_BYTES_PER_REQUEST) break;
      bytes += size;
      chunk.push(source.shift() as Entry);
    }
    return chunk;
  }

  /** Returns false when the caller should stop sending for now. */
  private applyOutcome(chunk: Entry[], outcome: Outcome): boolean {
    if (outcome === "sent") {
      this.consecutiveFailures = 0;
      return true;
    }
    if (outcome === "drop") return true;

    this.consecutiveFailures += 1;
    const kept = this.persist(chunk, outcome === "retry");
    if (kept > 0 || this.buffer.length > 0) this.scheduleRetry();
    return false;
  }

  private async buildRequest(
    entries: Entry[]
  ): Promise<{ payload: string; headers: Record<string, string>; custom: boolean }> {
    const payload = bodyOf(entries);
    const headers: Record<string, string> = {};
    if (this.consent === "granted") headers["X-GI-Consent"] = "granted";
    if (this.signingSecret && typeof crypto !== "undefined" && crypto.subtle) {
      // The signature covers a timestamp, so a captured request cannot be replayed later (the edge refuses
      // requests more than a few minutes old). Deploy the edge first: an older edge verifies the body alone.
      const timestamp = String(Math.floor(Date.now() / 1000));
      headers["X-GI-Timestamp"] = timestamp;
      headers["X-GI-Signature"] = await hmacSha256Hex(this.signingSecret, `${timestamp}.${payload}`);
    }
    const custom = Object.keys(headers).length > 0;
    // text/plain is a CORS-safelisted type, so with no custom headers the
    // browser skips the preflight request. The edge reads the body as JSON
    // whatever the content type.
    headers["Content-Type"] = custom ? "application/json" : "text/plain;charset=UTF-8";
    return { payload, headers, custom };
  }

  private async send(entries: Entry[]): Promise<Outcome> {
    try {
      const { payload, headers } = await this.buildRequest(entries);
      if (typeof fetch === "undefined") {
        return this.beacon(payload) ? "sent" : "offline";
      }
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: payload,
        keepalive: true,
      });
      this.noteHold(res);
      return classifyStatus(res.status);
    } catch {
      return "offline";
    }
  }

  /** Honour the server's pacing hints, capped at a minute so a bad header cannot silence the SDK. */
  private noteHold(res: Response): void {
    const header = (name: string) => Number(res.headers?.get(name));
    const backoff = header("X-GI-Backoff");
    const retryAfter = res.status === 429 || res.status === 503 ? header("Retry-After") * 1000 : 0;
    const ms = Math.max(backoff || 0, retryAfter || 0);
    if (ms > 0) this.holdUntil = Date.now() + Math.min(ms, 60_000);
  }

  private beacon(payload: string): boolean {
    try {
      if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return false;
      return navigator.sendBeacon(this.endpoint, new Blob([payload], { type: "text/plain;charset=UTF-8" }));
    } catch {
      return false;
    }
  }

  /**
   * The page is going away or being hidden. Nothing here may wait on async work
   * that the browser might cancel, so signed requests (which need an async
   * HMAC) are written to the retry queue and sent on the next page load.
   */
  public flushOnHide(): void {
    if (this.consent === "denied" || this.buffer.length === 0) return;
    this.cancelTimer();

    const pending = this.buffer;
    this.buffer = [];

    if (this.signingSecret) {
      this.persist(pending, false);
      return;
    }

    let sent = 0;
    while (pending.length > 0) {
      const chunk = this.takeChunk(pending);
      if (chunk.length === 0) continue;
      if (sent >= MAX_REQUESTS_ON_HIDE) {
        this.persist(chunk, false);
        continue;
      }
      sent += 1;
      this.sendOnHide(chunk);
    }
  }

  private sendOnHide(chunk: Entry[]): void {
    const payload = bodyOf(chunk);

    // A beacon cannot carry the consent header, so consented traffic uses fetch.
    if (this.consent !== "granted" && this.beacon(payload)) return;

    if (typeof fetch === "undefined") {
      this.persist(chunk, false);
      return;
    }
    const headers: Record<string, string> =
      this.consent === "granted"
        ? { "Content-Type": "application/json", "X-GI-Consent": "granted" }
        : { "Content-Type": "text/plain;charset=UTF-8" };
    fetch(this.endpoint, { method: "POST", headers, body: payload, keepalive: true })
      .then((res) => {
        if (classifyStatus(res.status) === "retry") this.persist(chunk, true);
      })
      .catch(() => this.persist(chunk, true));
  }

  /** Returns how many entries were stored; exhausted ones are discarded. */
  private persist(entries: Entry[], countAttempt: boolean): number {
    const kept: Entry[] = [];
    for (const entry of entries) {
      const attempts = entry.attempts + (countAttempt ? 1 : 0);
      if (attempts >= MAX_ATTEMPTS) continue;
      kept.push({ event: entry.event, attempts });
    }
    if (kept.length > 0) writeQueue([...readQueue(), ...kept]);
    return kept.length;
  }

  /** Move persisted events back into the send buffer, dropping the stale and the exhausted. */
  private replayPersisted(): void {
    if (this.consent === "denied") {
      writeQueue([]);
      return;
    }
    if (this.requireConsent && this.consent !== "granted") return;

    const queued = readQueue();
    if (queued.length === 0) return;
    writeQueue([]);

    const now = Date.now();
    const known = new Set(this.buffer.map((e) => e.event.eventId));
    for (const entry of queued) {
      if (entry.attempts >= MAX_ATTEMPTS) continue;
      const at = Date.parse(entry.event.occurredAt);
      if (Number.isNaN(at) || now - at > MAX_EVENT_AGE_MS) continue;
      if (known.has(entry.event.eventId)) continue;
      known.add(entry.event.eventId);
      this.buffer.push(entry);
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null || typeof window === "undefined") return;
    // +-25% jitter, so clients that failed together (an outage, a 429) do not all come back together.
    const backoff = Math.min(RETRY_BASE_MS * 3 ** (this.consecutiveFailures - 1), RETRY_MAX_MS);
    const delay = Math.max(Math.round(backoff * (0.75 + 0.5 * this.random())), this.holdUntil - Date.now());
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.replayPersisted();
      void this.flush();
    }, delay);
  }

  private clear(): void {
    this.cancelTimer();
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.buffer = [];
    writeQueue([]);
  }
}
