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
  /** Watch History API transitions for framework-agnostic SPA pageviews. */
  autoTrackSpa?: boolean;
  /** Wait for grantConsent() before sending (GDPR/CCPA gate). */
  requireConsent?: boolean;
  /**
   * HMAC secret for X-GI-Signature. Prefer a first-party proxy that injects
   * the secret server-side instead of embedding it in public HTML.
   */
  signingSecret?: string;
}

export interface PageviewOptions {
  /** A relative path or same-origin URL. Defaults to the current location. */
  url?: string;
  /** Title at the time the route is considered ready. */
  title?: string;
  /** The preceding internal route for client-side navigation. */
  referrer?: string;
  /** Send even if this URL was just observed by a router and History API. */
  force?: boolean;
}

const CONSENT_KEY = "_gi_consent";
const USER_ID_KEY = "_gi_uid";
const USER_TRAITS_KEY = "_gi_traits";

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

function readStoredUser(): { userId: string | null; traits: EventProperties | null } {
  try {
    const uid = window.localStorage.getItem(USER_ID_KEY);
    const rawTraits = window.localStorage.getItem(USER_TRAITS_KEY);
    const traits = rawTraits ? (JSON.parse(rawTraits) as EventProperties) : null;
    return { userId: uid, traits };
  } catch {
    return { userId: null, traits: null };
  }
}

function writeStoredUser(userId: string | null, traits: EventProperties | null): void {
  try {
    if (!userId) {
      window.localStorage.removeItem(USER_ID_KEY);
      window.localStorage.removeItem(USER_TRAITS_KEY);
      return;
    }
    window.localStorage.setItem(USER_ID_KEY, userId);
    if (traits) {
      window.localStorage.setItem(USER_TRAITS_KEY, JSON.stringify(traits));
    } else {
      window.localStorage.removeItem(USER_TRAITS_KEY);
    }
  } catch {
    // ignore
  }
}

export class GrowthTracker {
  private config: TrackerConfig;
  private transport: Transport;
  private isInitialized = false;
  private consent: "granted" | "denied" | null = null;
  private identifiedUserId: string | null = null;
  private identifiedUserTraits: EventProperties | null = null;
  private spaUnlisten: (() => void) | null = null;
  private lifecycleUnlisten: (() => void) | null = null;
  private lastPageviewUrl: string | null = null;
  private lastPageviewAt = 0;

  constructor(config: TrackerConfig) {
    this.config = {
      respectDNT: true,
      collectWebVitals: true,
      autoTrackSpa: true,
      requireConsent: false,
      ...config,
    };

    if (typeof window !== "undefined") {
      this.consent = readStoredConsent();
      const stored = readStoredUser();
      this.identifiedUserId = stored.userId;
      this.identifiedUserTraits = stored.traits;
    }

    this.transport = new Transport({
      endpoint: this.config.endpoint,
      ...(this.config.signingSecret ? { signingSecret: this.config.signingSecret } : {}),
      consent: this.consent,
      requireConsent: this.config.requireConsent === true,
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

    if ("prerendering" in document && document.prerendering) {
      document.addEventListener("prerenderingchange", () => this.start(), { once: true });
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
    if (this.lifecycleUnlisten) {
      this.lifecycleUnlisten();
      this.lifecycleUnlisten = null;
    }
    this.isInitialized = false;
  }

  public getConsent(): "granted" | "denied" | null {
    return this.consent;
  }

  private start(): void {
    if (this.isInitialized || typeof window === "undefined") return;
    this.isInitialized = true;

    this.trackPageview({ force: true });
    if (this.config.autoTrackSpa) {
      this.spaUnlisten = listenToRouteChanges((newPath, previousPath) => {
        this.trackNavigation(newPath, { referrer: previousPath });
      });
    }

    // A back/forward-cache restore does not re-run application bootstrap.
    // Treat the restored document as a new view automatically.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) this.trackPageview({ force: true });
    };
    window.addEventListener("pageshow", onPageShow);
    this.lifecycleUnlisten = () => window.removeEventListener("pageshow", onPageShow);

    if (this.config.collectWebVitals) {
      observeWebVitals((metric) => {
        this.trackWebVital(metric);
      });
    }
  }

  /**
   * Record the current document as a pageview. Accepts the original string
   * argument for backwards compatibility and rich options for router adapters.
   */
  public trackPageview(pathOrOptions?: string | PageviewOptions): boolean {
    if (typeof window === "undefined" || !this.isInitialized) return false;

    const options = typeof pathOrOptions === "string" ? {} : pathOrOptions ?? {};
    const eventUrl = this.resolveNavigationUrl(typeof pathOrOptions === "string" ? undefined : options.url);
    if (!eventUrl) return false;

    // React effects and framework router hooks often fire immediately after a
    // History API mutation. Suppress only the same URL in a short window, not
    // a later intentional revisit of the page.
    const now = Date.now();
    if (!options.force && eventUrl === this.lastPageviewUrl && now - this.lastPageviewAt < 1_000) {
      return false;
    }

    const path = typeof pathOrOptions === "string"
      ? pathOrOptions
      : `${new URL(eventUrl).pathname}${new URL(eventUrl).search}`;

    const event: TrackerEvent = {
      schemaVersion: 1,
      eventId: generateUUID(),
      type: "pageview",
      occurredAt: new Date().toISOString(),
      siteKey: this.config.siteKey,
      sessionId: getSessionId(),
      visitorPseudonym: getVisitorPseudonym(),
      url: eventUrl,
      path,
      title: options.title || document.title || undefined,
      referrer: options.referrer ? this.resolveNavigationUrl(options.referrer) ?? undefined : document.referrer || undefined,
      campaign: this.extractUTMs(),
      ...(this.identifiedUserId ? { userId: this.identifiedUserId } : {}),
      ...(this.identifiedUserTraits ? { userTraits: this.identifiedUserTraits } : {}),
      properties: this.identifiedUserId ? { distinctId: this.identifiedUserId } : undefined,
    };

    this.transport.enqueue(event);
    this.lastPageviewUrl = eventUrl;
    this.lastPageviewAt = now;
    return true;
  }

  /**
   * Router-safe navigation API for nonstandard client routers. Standard React,
   * Next.js, SvelteKit, Vue, Angular, Remix, and SPA routers need no manual
   * calls: `init()` observes their History API transitions automatically.
   */
  public trackNavigation(pathOrUrl?: string, options: Omit<PageviewOptions, "url"> = {}): boolean {
    return this.trackPageview({ ...options, ...(pathOrUrl ? { url: pathOrUrl } : {}) });
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
      ...(this.identifiedUserId ? { userId: this.identifiedUserId } : {}),
      ...(this.identifiedUserTraits ? { userTraits: this.identifiedUserTraits } : {}),
      properties: {
        eventName,
        ...(this.identifiedUserId ? { distinctId: this.identifiedUserId } : {}),
        ...(properties || {}),
      },
    };

    this.transport.enqueue(event);
  }

  /**
   * A semantic helper for conversion milestones. Define a matching
   * `goal_completed` custom-event goal in TrackMe, then segment by goal name.
   */
  public trackGoal(goal: string, properties?: EventProperties): void {
    this.trackEvent("goal_completed", { ...(properties || {}), goal });
  }

  /**
   * Identifies the current visitor with a stable unique user ID and optional traits.
   * Persists the identity across pages and sends an immediate $identify event.
   */
  public identify(userId: string, traits?: EventProperties): void {
    if (typeof window === "undefined" || !userId) return;
    this.identifiedUserId = userId;
    this.identifiedUserTraits = traits || null;
    writeStoredUser(userId, traits || null);

    if (!this.isInitialized) return;

    const event: TrackerEvent = {
      schemaVersion: 1,
      eventId: generateUUID(),
      type: "identify",
      occurredAt: new Date().toISOString(),
      siteKey: this.config.siteKey,
      sessionId: getSessionId(),
      visitorPseudonym: getVisitorPseudonym(),
      url: window.location.href,
      path: window.location.pathname,
      title: document.title || undefined,
      userId,
      userTraits: traits,
      properties: {
        eventName: "$identify",
        distinctId: userId,
        ...(traits || {}),
      },
    };

    this.transport.enqueue(event);
  }

  /**
   * Clears the current user identity when a user logs out.
   */
  public reset(): void {
    this.identifiedUserId = null;
    this.identifiedUserTraits = null;
    if (typeof window !== "undefined") {
      writeStoredUser(null, null);
    }
  }

  /**
   * Records a named funnel step without attaching a person-level identifier.
   * Funnel and step names are constrained by the same safe property rules as
   * every other custom event.
   */
  public trackFunnelStep(funnel: string, step: string, properties?: EventProperties): void {
    this.trackEvent("funnel_step", { ...(properties || {}), funnel, step });
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

  private resolveNavigationUrl(value?: string): string | null {
    try {
      return new URL(value || window.location.href, window.location.origin).href;
    } catch {
      return null;
    }
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
      autoTrackSpa: parseBoolAttr(scriptEl?.getAttribute("data-auto-track-spa") ?? null, true),
      requireConsent: parseBoolAttr(scriptEl?.getAttribute("data-require-consent") ?? null, false),
      ...(signingSecret ? { signingSecret } : {}),
    });
    tracker.init();
    (window as any).growth = tracker;
    (window as any).trackme = tracker;
  } else if (siteKey && !endpoint) {
    console.error(
      "[GrowthIntelligence] tracker script is missing data-endpoint - it will not initialize."
    );
  }
}
