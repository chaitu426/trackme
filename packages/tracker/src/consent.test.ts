import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getSessionId, getVisitorPseudonym } from "./session.js";

// The tracker reads a build-time constant; define it before the module loads.
(globalThis as Record<string, unknown>).__TRACKER_VERSION__ = "test";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GrowthTracker } = require("./index") as typeof import("./index.js");
type GrowthTracker = InstanceType<typeof GrowthTracker>;

let store: Map<string, string>;
let dnt: string | null;

beforeEach(() => {
  store = new Map();
  dnt = null;
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: "https://example.com/", pathname: "/", search: "", origin: "https://example.com", hostname: "example.com" },
    setTimeout: () => 1,
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  define("document", {
    visibilityState: "visible",
    referrer: "",
    title: "Home",
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  define("navigator", {
    get doNotTrack() {
      return dnt;
    },
    sendBeacon: () => true,
  });
  define("fetch", async () => ({ status: 202, ok: true }));
});

const make = (config: Partial<ConstructorParameters<typeof GrowthTracker>[0]> = {}) =>
  new GrowthTracker({
    siteKey: "site_key_12345",
    endpoint: "https://edge.test/v1/batch",
    collectWebVitals: false,
    autoTrackSpa: false,
    autoEvents: false,
    ...config,
  });
const running = (t: GrowthTracker) => (t as unknown as { isInitialized: boolean }).isInitialized;

test("granting consent does not override Do Not Track", () => {
  dnt = "1";
  const t = make({ requireConsent: true });
  t.init();
  t.grantConsent();
  assert.equal(t.getConsent(), "granted");
  assert.equal(running(t), false);
});

test("granting consent starts tracking when Do Not Track is off", () => {
  const t = make({ requireConsent: true });
  t.init();
  t.grantConsent();
  assert.equal(running(t), true);
});

test("an identity given before consent is not written to the browser until consent", () => {
  const t = make({ requireConsent: true });
  t.identify("user-42", { plan: "pro" });
  assert.equal(store.has("_gi_uid"), false);
  assert.equal(store.has("_gi_traits"), false);
  t.grantConsent();
  assert.equal(store.get("_gi_uid"), "user-42");
  assert.equal(store.get("_gi_traits"), JSON.stringify({ plan: "pro" }));
});

test("identity is stored straight away when consent is not required", () => {
  const t = make();
  t.identify("user-42");
  assert.equal(store.get("_gi_uid"), "user-42");
});

test("denying consent erases a stored identity", () => {
  store.set("_gi_uid", "user-42");
  const t = make();
  t.denyConsent();
  assert.equal(store.has("_gi_uid"), false);
});

test("a stored identity is not picked up while required consent is pending", () => {
  store.set("_gi_uid", "user-42");
  const t = make({ requireConsent: true });
  t.identify("someone-else");
  t.reset();
  assert.equal(store.has("_gi_uid"), false);
});

test("reset starts a new session and visitor for the next person on the browser", () => {
  const t = make();
  const session = getSessionId();
  const visitor = getVisitorPseudonym();
  t.identify("user-42");
  t.reset();
  assert.notEqual(getSessionId(), session);
  assert.notEqual(getVisitorPseudonym(), visitor);
  assert.equal(store.has("_gi_uid"), false);
});
