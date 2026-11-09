import type { TrackerEvent, EventProperties, ErrorPayload } from "@trackme/contracts";
import { generateUUID, getSessionId, getSessionSource, getVisitorPseudonym, resetVisit, type SessionSource } from "./session.js";
import { Transport } from "./transport.js";
import { listenToRouteChanges } from "./spa.js";
import { loadChunk, rememberScript } from "./lazy.js";
import { EngagementClock } from "./engagement.js";
import { isSameSite, listenForLinkClicks, listenForScrollDepth } from "./autocapture.js";
import { limitEvent } from "./limits.js";
import type { ErrorCapture } from "./errors/attach.js";

declare const __TRACKER_VERSION__: string;
/** Set by the build: true for the standalone script, false for the npm build. Must stay a bare constant so the unused branch is dropped. */
declare const __LAZY__: boolean;

const TRACKER_VERSION = __TRACKER_VERSION__ as string;

type VitalsModule = typeof import("./vitals.js");
// Web vitals are a separate file: standalone, a script next to tracker.js; npm, a dynamic import.
const loadVitals = (): Promise<VitalsModule | null> =>
  typeof __LAZY__ !== "undefined" && __LAZY__
    ? loadChunk<VitalsModule>("vitals")
    : import("./vitals.js").catch(() => null);

type ErrorsModule = typeof import("./errors/attach.js");
const loadErrors = (): Promise<ErrorsModule | null> =>
  typeof __LAZY__ !== "undefined" && __LAZY__
    ? loadChunk<ErrorsModule>("errors")
    : import("./errors/attach.js").catch(() => null);
const DEFAULT_TRACKER_ENDPOINT = "http://localhost:3001/v1/batch";

export interface TrackerConfig {
  siteKey: string;
  endpoint: string;
  respectDNT?: boolean;
  collectWebVitals?: boolean;
  /** Watch History API transitions for framework-agnostic SPA pageviews. */
  autoTrackSpa?: boolean;
  /** Wait for grantConsent() before sending (GDPR/CCPA gate). */
  requireConsent?: boolean;
  /** Record outbound link clicks, file downloads and scroll depth without any code. */
  autoEvents?: boolean;
  /**
   * HMAC secret for X-GI-Signature. Prefer a first-party proxy that injects
   * the secret server-side instead of embedding it in public HTML.
   */
  signingSecret?: string;
  /** Capture uncaught errors, rejected promises and failed requests (loads the error module). */
  errors?: boolean;
  /** With errors on, also report 4xx responses. */
  errors4xx?: boolean;
  /** With errors on, also report console.error calls. */
  errorsConsole?: boolean;
  /** Build label on every event, e.g. "web@1.4.2". Invalid values are dropped, never sent. */
  release?: string;
  /** "production" (default), "staging" or "development". */
  environment?: string;
}

export interface PageviewOptions {
  /** A relative path or same-origin URL. Defaults to the current location. */
  url?: string;
  /** Title at the time the route is considered ready. */
  title?: string;
  /**
   * Accepted for compatibility and ignored. Moving between pages of the same site is not a
   * traffic source: every page of a visit carries the visit's own referrer and campaign.
   */
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
  private clock: EngagementClock | null = null;
  private scrollDepth: { reset: () => void; stop: () => void } | null = null;
  private teardown: Array<() => void> = [];
  private errorApi: ErrorCapture | null = null;
  /** Error calls made before the error module finished loading; replayed once it has. */
  private errorCalls: Array<(api: ErrorCapture) => void> = [];
  /** The page the document was loaded on. Web vitals describe it, whatever route the visitor is on when they leave. */
  private landing: { url: string; path: string } | null = null;

  constructor(config: TrackerConfig) {
    this.config = {
      respectDNT: true,
      collectWebVitals: true,
      autoTrackSpa: true,
      requireConsent: false,
      autoEvents: true,
      ...config,
    };

    if (typeof window !== "undefined") {
      this.consent = readStoredConsent();
      if (this.consent === "denied") {
        writeStoredUser(null, null);
      } else if (this.mayStore()) {
        const stored = readStoredUser();
        this.identifiedUserId = stored.userId;
        this.identifiedUserTraits = stored.traits;
      }
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

    if (this.blockedByDnt()) {
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
    // An identity given while consent was pending is only kept now.
    if (this.identifiedUserId) writeStoredUser(this.identifiedUserId, this.identifiedUserTraits);
    // Consent does not override Do Not Track: a visitor who sends it is still not tracked.
    if (!this.isInitialized && !this.blockedByDnt()) {
      this.start();
    }
  }

  private blockedByDnt(): boolean {
    return this.config.respectDNT === true && typeof navigator !== "undefined" && navigator.doNotTrack === "1";
  }

  /** Identity may be written to the browser unless consent is required and not given, or was refused. */
  private mayStore(): boolean {
    return this.consent !== "denied" && (!this.config.requireConsent || this.consent === "granted");
  }

  /** Call after the visitor declines analytics. */
  public denyConsent(): void {
    this.consent = "denied";
    writeStoredConsent("denied");
    this.transport.setConsent("denied");
    this.identifiedUserId = null;
    this.identifiedUserTraits = null;
    writeStoredUser(null, null);
    if (this.spaUnlisten) {
      this.spaUnlisten();
      this.spaUnlisten = null;
    }
    if (this.lifecycleUnlisten) {
      this.lifecycleUnlisten();
      this.lifecycleUnlisten = null;
    }
    this.stopListeners();
    this.isInitialized = false;
  }

  public getConsent(): "granted" | "denied" | null {
    return this.consent;
  }

  private start(): void {
    if (this.isInitialized || typeof window === "undefined") return;
    this.isInitialized = true;

    this.landing = { url: window.location.href, path: window.location.pathname + window.location.search };
    this.clock = new EngagementClock();

    this.trackPageview({ force: true });
    if (this.config.autoTrackSpa) {
      this.spaUnlisten = listenToRouteChanges((newPath, previousPath) => {
        // Close out the page being left before the next one opens.
        this.sendEngagement(previousPath);
        this.errorApi?.navigated(newPath);
        this.scrollDepth?.reset();
        this.trackNavigation(newPath);
      });
    }

    // Active time is sent whenever the page is hidden or left, in pieces that add up.
    const onHide = () => {
      if (document.visibilityState === "hidden") this.sendEngagement();
    };
    const onPageHide = () => this.sendEngagement();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    this.teardown.push(() => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    });

    if (this.config.autoEvents) {
      const track = (name: string, properties: EventProperties) => this.trackEvent(name, properties);
      this.teardown.push(listenForLinkClicks(track, () => this.transport.flushOnHide()));
      this.scrollDepth = listenForScrollDepth(track);
    }

    // A back/forward-cache restore does not re-run application bootstrap.
    // Treat the restored document as a new view automatically.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        this.scrollDepth?.reset();
        this.trackPageview({ force: true });
      }
    };
    window.addEventListener("pageshow", onPageShow);
    this.lifecycleUnlisten = () => window.removeEventListener("pageshow", onPageShow);

    if (this.config.errors) {
      void loadErrors().then((mod) => {
        // The visitor may have declined analytics while the module was loading.
        if (!mod || !this.isInitialized) return;
        const api = mod.createErrorCapture({
          send: (error) => this.sendError(error),
          endpoint: this.config.endpoint,
          capture4xx: this.config.errors4xx,
          captureConsole: this.config.errorsConsole,
        });
        this.errorApi = api;
        this.teardown.push(() => {
          api.stop();
          this.errorApi = null;
        });
        for (const call of this.errorCalls.splice(0)) call(api);
      });
    }

    if (this.config.collectWebVitals) {
      void loadVitals().then((vitals) =>
        vitals?.observeWebVitals((metric) => {
          this.trackWebVital(metric);
        })
      );
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

    const source = this.sessionSource();
    this.transport.enqueue(
      this.build("pageview", {
        url: eventUrl,
        path,
        title: options.title || document.title || undefined,
        referrer: source.referrer,
        campaign: this.extractUTMs() ?? (source.campaign as TrackerEvent["campaign"]),
        properties: this.identifiedUserId ? { distinctId: this.identifiedUserId } : undefined,
      })
    );
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

    this.transport.enqueue(
      this.build("custom", {
        title: document.title || undefined,
        properties: {
          eventName,
          ...(this.identifiedUserId ? { distinctId: this.identifiedUserId } : {}),
          ...(properties || {}),
        },
      })
    );
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
    if (this.mayStore()) writeStoredUser(userId, traits || null);

    if (!this.isInitialized) return;

    this.transport.enqueue(
      this.build("identify", {
        title: document.title || undefined,
        userId,
        userTraits: traits,
        properties: { eventName: "$identify", distinctId: userId, ...(traits || {}) },
      })
    );
  }

  /**
   * Clears the current user identity when a user logs out.
   */
  public reset(): void {
    this.identifiedUserId = null;
    this.identifiedUserTraits = null;
    if (typeof window !== "undefined") {
      writeStoredUser(null, null);
      // The next person on this browser is not a continuation of this visit.
      resetVisit();
    }
  }

  /**
   * A checkout milestone as the shopper's browser saw it: `trackPayment("initiated", { orderId, amount, currency, method })`.
   * The order id is what ties the gateway's webhook to this session. Never pass card or UPI details.
   */
  public trackPayment(stage: string, properties?: EventProperties): void {
    this.trackEvent("payment_" + stage, properties);
  }

  /**
   * Records a named funnel step without attaching a person-level identifier.
   * Funnel and step names are constrained by the same safe property rules as
   * every other custom event.
   */
  public trackFunnelStep(funnel: string, step: string, properties?: EventProperties): void {
    this.trackEvent("funnel_step", { ...(properties || {}), funnel, step });
  }

  /**
   * Report an error you caught yourself: `trackme.captureException(err, { tags: { step: "pay" } })`.
   * Needs `errors` on (data-errors="true"); otherwise it does nothing. Never throws.
   */
  public captureException(
    error: unknown,
    context?: { tags?: Record<string, string>; level?: ErrorPayload["level"]; fingerprint?: string }
  ): void {
    this.withErrors((api) => api.captureException(error, context));
  }

  /** Report a message as an issue, e.g. `captureMessage("Checkout stalled", "warning")`. */
  public captureMessage(message: string, level?: ErrorPayload["level"]): void {
    this.withErrors((api) => api.captureMessage(String(message), level));
  }

  /** Attach a tag (at most 10) to every later error: `setTag("plan", "pro")`. */
  public setTag(key: string, value: string): void {
    this.withErrors((api) => api.setTag(key, value));
  }

  private withErrors(call: (api: ErrorCapture) => void): void {
    try {
      if (!this.config.errors || typeof window === "undefined") return;
      if (this.errorApi) call(this.errorApi);
      else if (this.errorCalls.length < 20) this.errorCalls.push(call);
    } catch {
      // The SDK never throws into the host app.
    }
  }

  private sendError(error: ErrorPayload): void {
    if (typeof window === "undefined" || !this.isInitialized) return;
    // The address without its query string or fragment, which is where tokens and emails end up.
    this.transport.enqueue(
      this.build("error", {
        error,
        url: `${window.location.origin}${window.location.pathname}`,
        path: window.location.pathname,
      })
    );
  }

  private trackWebVital(metric: any): void {
    if (typeof window === "undefined" || !this.isInitialized) return;

    // Vitals describe the page, not the person, so no identity fields are attached. They belong
    // to the page the document loaded on, even if the visitor has navigated on since.
    const page = this.landing ? { url: this.landing.url, path: this.landing.path } : {};
    this.transport.enqueue(this.build("web_vital", { webVital: metric, ...page }, false));
  }

  /**
   * Sends the active time since the last report. `path` names the page being left on a
   * client-side navigation, when the address bar has already moved on.
   */
  private sendEngagement(path?: string): void {
    if (!this.clock || !this.isInitialized) return;
    const ms = Math.round(this.clock.take());
    if (ms < 100) return;
    const page = path ? { url: this.resolveNavigationUrl(path) ?? window.location.href, path } : {};
    this.transport.enqueue(this.build("engagement", { properties: { engagementMs: ms }, ...page }));
    // The page may be going away: do not wait for the batch timer.
    this.transport.flushOnHide();
  }

  /** Where this visit came from, fixed when it began. Visits from the site's own pages carry no referrer. */
  private sessionSource(): SessionSource {
    getSessionId();
    return getSessionSource(() => {
      const external = document.referrer && !this.isSelfReferrer(document.referrer) ? document.referrer : undefined;
      const campaign = this.extractUTMs();
      return {
        ...(external ? { referrer: external } : {}),
        ...(campaign ? { campaign: campaign as Record<string, string> } : {}),
      };
    });
  }

  private isSelfReferrer(referrer: string): boolean {
    try {
      return isSameSite(new URL(referrer).hostname, window.location.hostname);
    } catch {
      return false;
    }
  }

  private stopListeners(): void {
    for (const stop of this.teardown) stop();
    this.teardown = [];
    this.clock?.stop();
    this.clock = null;
    this.scrollDepth?.stop();
    this.scrollDepth = null;
  }

  /** Fields every event shares; `fields` overrides them (a pageview supplies its own url and path). */
  private build(
    type: TrackerEvent["type"],
    fields: Partial<TrackerEvent>,
    withIdentity = true
  ): TrackerEvent {
    return limitEvent({
      schemaVersion: 1,
      eventId: generateUUID(),
      type,
      occurredAt: new Date().toISOString(),
      siteKey: this.config.siteKey,
      sessionId: getSessionId(),
      visitorPseudonym: getVisitorPseudonym(),
      tv: TRACKER_VERSION,
      url: window.location.href,
      path: window.location.pathname,
      ...(withIdentity && this.identifiedUserId ? { userId: this.identifiedUserId } : {}),
      ...(withIdentity && this.identifiedUserTraits ? { userTraits: this.identifiedUserTraits } : {}),
      ...(this.config.release ? { release: this.config.release } : {}),
      ...(this.config.environment ? { environment: this.config.environment as TrackerEvent["environment"] } : {}),
      ...fields,
    } as TrackerEvent);
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

const QUEUEABLE = [
  "trackPageview", "trackNavigation", "trackEvent", "trackGoal", "trackFunnelStep", "trackPayment",
  "identify", "reset", "grantConsent", "denyConsent", "captureException", "captureMessage", "setTag",
];

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
  const endpoint = scriptEl?.getAttribute("data-endpoint") ?? DEFAULT_TRACKER_ENDPOINT;

  const existing = (window as any).trackme;
  // A second copy of the snippet (GTM plus a hard-coded tag, a hot reload) would send every event twice.
  const alreadyRunning = typeof existing?.trackPageview === "function";

  if (siteKey && !alreadyRunning) {
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
      autoEvents: parseBoolAttr(scriptEl?.getAttribute("data-auto-events") ?? null, true),
      requireConsent: parseBoolAttr(scriptEl?.getAttribute("data-require-consent") ?? null, false),
      errors: parseBoolAttr(scriptEl?.getAttribute("data-errors") ?? null, false),
      errors4xx: parseBoolAttr(scriptEl?.getAttribute("data-errors-4xx") ?? null, false),
      errorsConsole: parseBoolAttr(scriptEl?.getAttribute("data-errors-console") ?? null, false),
      ...(scriptEl?.getAttribute("data-release") ? { release: scriptEl.getAttribute("data-release") as string } : {}),
      ...(scriptEl?.getAttribute("data-environment") ? { environment: scriptEl.getAttribute("data-environment") as string } : {}),
      ...(signingSecret ? { signingSecret } : {}),
    });
    rememberScript(scriptEl);
    tracker.init();
    (window as any).growth = tracker;
    (window as any).trackme = tracker;
    // Calls made before this script loaded: `trackme.q = trackme.q || []; trackme.q.push(["trackEvent", "signup"])`.
    for (const call of Array.isArray(existing?.q) ? existing.q : []) {
      const [method, ...args] = Array.from(call as ArrayLike<unknown>);
      try {
        const fn = (tracker as any)[method as string];
        if (QUEUEABLE.includes(method as string) && typeof fn === "function") fn.apply(tracker, args);
      } catch {
        // A bad queued call must not stop the rest.
      }
    }
  }
}
