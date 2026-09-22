import { TrackerEvent } from "@trackme/contracts";

export interface TransportOptions {
  endpoint: string;
  batchSize?: number;
  flushIntervalMs?: number;
  /** HMAC secret for X-GI-Signature. Prefer first-party proxy over exposing in page HTML. */
  signingSecret?: string;
  /** Sent as X-GI-Consent when requireConsent is enabled server-side. */
  consent?: "granted" | "denied" | null;
}

const RETRY_QUEUE_KEY = "_gi_retry_queue";
const MAX_QUEUED_EVENTS = 100;

function readRetryQueue(): TrackerEvent[] {
  try {
    const raw = window.localStorage.getItem(RETRY_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as TrackerEvent[]) : [];
  } catch {
    return [];
  }
}

function writeRetryQueue(events: TrackerEvent[]): void {
  try {
    if (events.length === 0) {
      window.localStorage.removeItem(RETRY_QUEUE_KEY);
      return;
    }
    window.localStorage.setItem(RETRY_QUEUE_KEY, JSON.stringify(events.slice(-MAX_QUEUED_EVENTS)));
  } catch {
    // Best-effort only
  }
}

function persistForRetry(events: TrackerEvent[]): void {
  writeRetryQueue([...readRetryQueue(), ...events]);
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
  private buffer: TrackerEvent[] = [];
  private timer: number | null = null;
  private readonly endpoint: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly signingSecret?: string | undefined;
  private consent: "granted" | "denied" | null;
  private unloading = false;
  private flushing = false;

  constructor(options: TransportOptions) {
    this.endpoint = options.endpoint;
    this.batchSize = options.batchSize ?? 5;
    this.flushIntervalMs = options.flushIntervalMs ?? 500;
    this.signingSecret = options.signingSecret;
    this.consent = options.consent ?? null;

    if (typeof window !== "undefined") {
      const queued = readRetryQueue();
      if (queued.length > 0) {
        writeRetryQueue([]);
        this.buffer.push(...queued);
        this.timer = window.setTimeout(() => void this.flush(), this.flushIntervalMs);
      }

      window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          this.unloading = true;
          void this.flush();
          this.unloading = false;
        }
      });
      window.addEventListener("pagehide", () => {
        this.unloading = true;
        void this.flush();
        this.unloading = false;
      });
    }
  }

  public setConsent(value: "granted" | "denied" | null): void {
    this.consent = value;
  }

  public enqueue(event: TrackerEvent): void {
    this.buffer.push(event);

    if (this.buffer.length >= this.batchSize) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = window.setTimeout(() => void this.flush(), this.flushIntervalMs);
    }
  }

  public async flush(): Promise<void> {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.buffer.length === 0 || this.flushing) return;
    this.flushing = true;

    const eventsToSend = [...this.buffer];
    this.buffer = [];

    try {
      const payload = JSON.stringify({ events: eventsToSend });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.consent === "granted") {
        headers["X-GI-Consent"] = "granted";
      }
      if (this.signingSecret && typeof crypto !== "undefined" && crypto.subtle) {
        headers["X-GI-Signature"] = await hmacSha256Hex(this.signingSecret, payload);
      }

      if (typeof fetch !== "undefined") {
        try {
          const res = await fetch(this.endpoint, {
            method: "POST",
            headers,
            body: payload,
            keepalive: true,
          });
          if (!res.ok) {
            persistForRetry(eventsToSend);
          }
        } catch {
          if (
            this.unloading &&
            typeof navigator !== "undefined" &&
            typeof navigator.sendBeacon === "function"
          ) {
            try {
              const blob = new Blob([payload], { type: "application/json" });
              navigator.sendBeacon(this.endpoint, blob);
            } catch {
              // ignore
            }
          }
          persistForRetry(eventsToSend);
        }
        return;
      }

      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([payload], { type: "application/json" });
        if (!navigator.sendBeacon(this.endpoint, blob)) {
          persistForRetry(eventsToSend);
        }
        return;
      }

      persistForRetry(eventsToSend);
    } finally {
      this.flushing = false;
    }
  }
}
