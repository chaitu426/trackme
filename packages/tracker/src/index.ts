import { TrackerEvent, EventProperties } from "@trackme/contracts";
import { generateUUID, getSessionId, getVisitorPseudonym } from "./session.js";
import { Transport } from "./transport.js";
import { listenToRouteChanges } from "./spa.js";
import { observeWebVitals } from "./vitals.js";

export interface TrackerConfig {
  siteKey: string;
  endpoint: string;
  respectDNT?: boolean;
  collectWebVitals?: boolean;
  /** Wait for grantConsent() before sending (GDPR/CCPA gate). */
  requireConsent?: boolean;
  /**
   * HMAC secret for X-GI-Signature. Prefer a first-party proxy that injects
   * the secret server-side instead of embedding it in public HTML.
   */
  signingSecret?: string;
}

const CONSENT_KEY = "_gi_consent";

function readStoredConsent(): "granted" | "denied" | null {
  try {
    const v = window.localStorage.getItem(CONSENT_KEY);
    if (v === "granted" || v === "denied") return v;
  } catch {
    // ignore
  }
  return null;
}

function writeStoredConsent(value: "granted" | "denied" | null): void {
  try {
    if (!value) {
      window.localStorage.removeItem(CONSENT_KEY);
      return;
    }
    window.localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // ignore
  }
}

export class GrowthTracker {
  private config: TrackerConfig;
  private transport: Transport;
  private isInitialized = false;
  private consent: "granted" | "denied" | null = null;
  private spaUnlisten: (() => void) | null = null;

  constructor(config: TrackerConfig) {
    this.config = {
      respectDNT: true,
      collectWebVitals: true,
      requireConsent: false,
      ...config,
    };

    if (typeof window !== "undefined") {
      this.consent = readStoredConsent();
    }

    this.transport = new Transport({
      endpoint: this.config.endpoint,
      ...(this.config.signingSecret ? { signingSecret: this.config.signingSecret } : {}),
      consent: this.consent === "granted" ? "granted" : null,
    });
  }

  public init(): void {
    if (this.isInitialized || typeof window === "undefined") return;

    if (this.config.respectDNT && navigator.doNotTrack === "1") {
      return;
    }

    if (this.config.requireConsent && this.consent !== "granted") {
      // Armed but idle until grantConsent().
      return;
    }

    this.start();
  }

  /** Call after the visitor accepts analytics (CMP / banner). */
  public grantConsent(): void {
    this.consent = "granted";
    writeStoredConsent("granted");
    this.transport.setConsent("granted");
    if (!this.isInitialized) {
      this.start();
    }
  }

  /** Call after the visitor declines analytics. */
  public denyConsent(): void {
    this.consent = "denied";
    writeStoredConsent("denied");
    this.transport.setConsent("denied");
    if (this.spaUnlisten) {
      this.spaUnlisten();
      this.spaUnlisten = null;
    }
    this.isInitialized = false;
  }

  public getConsent(): "granted" | "denied" | null {
    return this.consent;
  }

  private start(): void {
    if (this.isInitialized || typeof window === "undefined") return;
    this.isInitialized = true;

    this.trackPageview();
    this.spaUnlisten = listenToRouteChanges(() => {
      this.trackPageview();
    });

    if (this.config.collectWebVitals) {
      observeWebVitals((metric) => {
        this.trackWebVital(metric);
      });
    }
  }

  public trackPageview(customPath?: string): void {
    if (typeof window === "undefined" || !this.isInitialized) return;

    const event: TrackerEvent = {
      schemaVersion: 1,
      eventId: generateUUID(),
      type: "pageview",
      occurredAt: new Date().toISOString(),
      siteKey: this.config.siteKey,
      sessionId: getSessionId(),
      visitorPseudonym: getVisitorPseudonym(),
      url: window.location.href,
      path: customPath || window.location.pathname,
      title: document.title || undefined,
      referrer: document.referrer || undefined,
      campaign: this.extractUTMs(),
    };

    this.transport.enqueue(event);
  }

  public trackEvent(eventName: string, properties?: EventProperties): void {
    if (typeof window === "undefined" || !this.isInitialized) return;

    const event: TrackerEvent = {
      schemaVersion: 1,
      eventId: generateUUID(),
      type: "custom",
      occurredAt: new Date().toISOString(),
      siteKey: this.config.siteKey,
      sessionId: getSessionId(),
      visitorPseudonym: getVisitorPseudonym(),
      url: window.location.href,
      path: window.location.pathname,
      title: document.title || undefined,
      properties: {
        eventName,
        ...(properties || {}),
      },
    };

    this.transport.enqueue(event);
  }

  private trackWebVital(metric: any): void {
    if (typeof window === "undefined" || !this.isInitialized) return;

    const event: TrackerEvent = {
      schemaVersion: 1,
      eventId: generateUUID(),
      type: "web_vital",
      occurredAt: new Date().toISOString(),
      siteKey: this.config.siteKey,
      sessionId: getSessionId(),
      visitorPseudonym: getVisitorPseudonym(),
      url: window.location.href,
      path: window.location.pathname,
      webVital: metric,
    };

    this.transport.enqueue(event);
  }

  private extractUTMs(): TrackerEvent["campaign"] {
    if (typeof window === "undefined") return undefined;

    const params = new URLSearchParams(window.location.search);
    const campaign = {
      source: params.get("utm_source") || undefined,
      medium: params.get("utm_medium") || undefined,
      campaign: params.get("utm_campaign") || undefined,
      term: params.get("utm_term") || undefined,
      content: params.get("utm_content") || undefined,
    };

    const hasAny = Object.values(campaign).some(Boolean);
    return hasAny ? campaign : undefined;
  }
}

function parseBoolAttr(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return fallback;
}

function resolveTrackerScript(): HTMLScriptElement | null {
  if (typeof document === "undefined") return null;

  const current = document.currentScript as HTMLScriptElement | null;
  if (current?.getAttribute("data-site") && current.getAttribute("data-endpoint")) {
    return current;
  }

  return document.querySelector<HTMLScriptElement>("script[data-site][data-endpoint]");
}

if (typeof document !== "undefined") {
  const scriptEl = resolveTrackerScript();
  const siteKey = scriptEl?.getAttribute("data-site");
  const endpoint = scriptEl?.getAttribute("data-endpoint");

  if (siteKey && endpoint) {
    const signingSecret = scriptEl?.getAttribute("data-signing-secret") || undefined;
    const tracker = new GrowthTracker({
      siteKey,
      endpoint,
      respectDNT: parseBoolAttr(scriptEl?.getAttribute("data-respect-dnt") ?? null, true),
      collectWebVitals: parseBoolAttr(
        scriptEl?.getAttribute("data-collect-web-vitals") ?? null,
        true
      ),
      requireConsent: parseBoolAttr(scriptEl?.getAttribute("data-require-consent") ?? null, false),
      ...(signingSecret ? { signingSecret } : {}),
    });
    tracker.init();
    (window as any).growth = tracker;
  } else if (siteKey && !endpoint) {
    console.error(
      "[GrowthIntelligence] tracker script is missing data-endpoint - it will not initialize."
    );
  }
}
