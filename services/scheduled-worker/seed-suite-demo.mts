/**
 * Fills one site with realistic demo data so every dashboard page has something to show.
 *
 *   node --import tsx seed-suite-demo.mts [--site-key=site_pub_...] [--reseed | --remove | --live]
 *   (from services/scheduled-worker, or `pnpm seed:suite -- --live` from the repo root)
 *   --live  adds a few sessions happening right now, for the Realtime page (they last about five minutes)
 *
 * What it writes, and how:
 *  - 35 days of traffic as events through the event worker's own writers (legacy tables and v2, exactly like live
 *    ingestion): pageviews, engagement, web vitals, custom events, identified users, three releases and errors.
 *  - Error issues through the worker's error path (grouping, scrubbing, sampled occurrences).
 *  - Postgres: goals, funnels, saved segments, reported deploys, issue statuses.
 *  - A source map for the 1.2.0 checkout error, in the object store, so the stack reads as original source.
 *  - A few live sessions in Redis (Realtime shows them for about five minutes), then runs the rollup jobs.
 *
 * Every event carries properties.demo = true, which is how --remove finds them. --remove deletes the demo events and
 * the site's derived aggregates for the seeded period (real events stay; the rollup job rebuilds their legacy rollups).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import { env } from "@trackme/config";
import type { EnrichedEvent } from "@trackme/contracts";
import { and, db, eq, goals, inArray, siteErrorStatus, siteFunnels, siteReleases, siteSegments, sites, workspaces } from "@trackme/db";
import { getClickHouseClient } from "@trackme/analytics";
import { FileSystemObjectStore } from "@trackme/object-store";
import { prepareErrorEvents } from "../event-worker/src/errors/prepare.js";
import { createErrorWriter } from "../event-worker/src/errors/writer.js";
import { createClickHouseWriter } from "../event-worker/src/writers/clickhouse.js";
import { updateRealtimeState } from "../event-worker/src/state/redis-realtime.js";
import { mapKey } from "../../apps/web/src/lib/sourcemaps.js";
import { runHourlyRollups } from "./src/jobs/hourly-rollups.js";
import { GROUPS, runDailyRollups } from "./src/jobs/daily-rollups.js";
import { RETENTION_TABLES } from "./src/jobs/retention.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const SITE_KEY = args.find((a) => a.startsWith("--site-key="))?.split("=")[1] ?? "site_pub_JI7qJQ5_E0WXH5SRwqJFLx59";
const REMOVE = args.includes("--remove");
const RESEED = args.includes("--reseed");
const LIVE = args.includes("--live");

const DAY = 86_400_000;
const NOW = Date.now();
const HISTORY_DAYS = 35;
const REL = { old: "web@1.0.0", mid: "web@1.1.0", cur: "web@1.2.0" };
const DEPLOY_MID = NOW - 12 * DAY;
const DEPLOY_CUR = NOW - 2.5 * DAY;
const MIN_FILE = "/assets/app.4f2a9c1b.js";
const DB = "growth_analytics";
const ch = getClickHouseClient();

/* ───────────────────────────── deterministic randomness ───────────────────────────── */
let state = 20261109;
function rand(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
function weighted<T extends { w: number }>(items: readonly T[]): T {
  let r = rand() * items.reduce((s, i) => s + i.w, 0);
  for (const item of items) if ((r -= item.w) <= 0) return item;
  return items[0]!;
}
const between = (a: number, b: number) => a + rand() * (b - a);
const id = (n = 10) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rand() * 36)]).join("");
function uuid(): string {
  const h = Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(rand() * 16)]);
  h[12] = "4";
  h[16] = "89ab"[Math.floor(rand() * 4)]!;
  return `${h.slice(0, 8).join("")}-${h.slice(8, 12).join("")}-${h.slice(12, 16).join("")}-${h.slice(16, 20).join("")}-${h.slice(20).join("")}`;
}

/* ───────────────────────────── catalogues ───────────────────────────── */
const PAGES = [
  { p: "/", t: "Acme Analytics: privacy-first product analytics", w: 30 },
  { p: "/pricing", t: "Pricing | Acme Analytics", w: 16 },
  { p: "/features", t: "Features | Acme Analytics", w: 12 },
  { p: "/docs/getting-started", t: "Getting started | Acme Docs", w: 12 },
  { p: "/blog/privacy-first-analytics", t: "Why privacy-first analytics wins", w: 8 },
  { p: "/blog/scaling-clickhouse", t: "How we scaled on ClickHouse", w: 6 },
  { p: "/demo.html", t: "Live demo", w: 5 },
  { p: "/signup", t: "Create your account", w: 6 },
  { p: "/contact", t: "Contact sales", w: 3 },
  { p: "/integrations", t: "Integrations", w: 2 },
] as const;
const TITLES = new Map<string, string>([...PAGES.map((x) => [x.p, x.t] as [string, string]), ["/checkout", "Checkout"], ["/checkout/success", "Thank you"]]);
const SOURCES = [
  { ref: "", utm: null, w: 28 },
  { ref: "https://www.google.com/search", utm: null, w: 34 },
  { ref: "https://github.com/topics/analytics", utm: null, w: 9 },
  { ref: "https://news.ycombinator.com/item?id=41829312", utm: null, w: 7 },
  { ref: "https://t.co/launch", utm: { source: "twitter", medium: "social", campaign: "autumn_launch" }, w: 10 },
  { ref: "", utm: { source: "newsletter", medium: "email", campaign: "weekly_digest" }, w: 7 },
  { ref: "https://www.producthunt.com/posts/acme", utm: { source: "producthunt", medium: "referral", campaign: "launch_day" }, w: 5 },
] as const;
const COUNTRIES = [
  { c: "IN", w: 28 }, { c: "US", w: 26 }, { c: "DE", w: 9 }, { c: "GB", w: 8 }, { c: "BR", w: 7 },
  { c: "FR", w: 5 }, { c: "CA", w: 4 }, { c: "AU", w: 3 }, { c: "NL", w: 3 }, { c: "SG", w: 2 }, { c: "JP", w: 2 }, { c: "ES", w: 3 },
] as const;
const BROWSERS = [{ b: "Chrome", w: 56 }, { b: "Safari", w: 22 }, { b: "Firefox", w: 9 }, { b: "Edge", w: 10 }, { b: "Samsung Internet", w: 3 }] as const;
const COMPANIES = ["Northwind", "Globex", "Initech", "Umbrella", "Hooli", "Stark Labs", "Wayne Corp", "Acme Retail", "Pied Piper", "Soylent"];
const ROLES = ["Founder", "Engineer", "Product Manager", "Marketer", "Designer"];

interface Visitor { browser: string; os: string; device: "desktop" | "mobile" | "tablet"; country: string }
function newVisitor(): Visitor {
  const { b } = weighted(BROWSERS);
  const device = rand() < 0.62 ? "desktop" : rand() < 0.87 ? "mobile" : "tablet";
  const os = b === "Safari" ? (device === "desktop" ? "macOS" : "iOS") : device === "desktop" ? pick(["Windows", "Windows", "macOS", "Linux"]) : device === "mobile" ? "Android" : "iPadOS";
  return { browser: b, os, device, country: weighted(COUNTRIES).c };
}

/* ───────────────────────────── event construction ───────────────────────────── */
const DOMAIN_HOLDER = { domain: "", siteId: "", workspaceId: "" };
function baseEvent(over: Partial<EnrichedEvent> & { type: EnrichedEvent["type"] }): EnrichedEvent {
  const at = new Date((over as { _t?: number })._t ?? NOW);
  const { _t: _drop, ...rest } = over as Record<string, unknown>;
  return {
    schemaVersion: 1,
    eventId: uuid(),
    occurredAt: at.toISOString(),
    siteKey: SITE_KEY,
    url: `https://${DOMAIN_HOLDER.domain}/`,
    path: "/",
    workspaceId: DOMAIN_HOLDER.workspaceId,
    siteId: DOMAIN_HOLDER.siteId,
    receivedAt: new Date(at.getTime() + 150).toISOString(),
    isBot: false,
    botStatus: "human",
    environment: "production",
    ...rest,
  } as unknown as EnrichedEvent;
}

function releaseAt(t: number): string {
  if (t >= DEPLOY_CUR) return rand() < 0.03 ? REL.mid : REL.cur;
  if (t >= DEPLOY_MID) return rand() < 0.03 ? REL.old : REL.mid;
  return REL.old;
}

const rating = (name: string, v: number): string => {
  const limits: Record<string, [number, number]> = { LCP: [2500, 4000], FCP: [1800, 3000], TTFB: [800, 1800], INP: [200, 500], CLS: [0.1, 0.25] };
  const [good, poor] = limits[name]!;
  return v <= good ? "good" : v <= poor ? "needs-improvement" : "poor";
};

interface Person { userId: string | null; traits: Record<string, string | number | boolean>; visitor: Visitor }

/** The minified frames of the 1.2.0 checkout error; positions match the source map written below. */
const CHECKOUT_FRAMES = [
  { fn: "r", file: `https://DOMAIN${MIN_FILE}`, line: 1, col: 52, inApp: true },
  { fn: "e", file: `https://DOMAIN${MIN_FILE}`, line: 1, col: 144, inApp: true },
  { fn: "t", file: `https://DOMAIN${MIN_FILE}`, line: 1, col: 512, inApp: true },
];

function errorPayload(kind: "items" | "cart500" | "analytics" | "timeout" | "email", t: number, email: string) {
  const crumbs = (extra: Array<{ k: "navigation" | "click" | "fetch" | "log"; m: string }>) =>
    extra.map((c, i) => ({ ts: t - (extra.length - i) * 1400, k: c.k, m: c.m }));
  const d = DOMAIN_HOLDER.domain;
  switch (kind) {
    case "items":
      return {
        type: "TypeError", message: "Cannot read properties of undefined (reading 'items')", level: "error" as const,
        frames: CHECKOUT_FRAMES.map((f) => ({ ...f, file: f.file.replace("DOMAIN", d) })),
        breadcrumbs: crumbs([{ k: "navigation", m: "/pricing" }, { k: "navigation", m: "/checkout" }, { k: "fetch", m: "GET /api/cart 200 84ms" }, { k: "click", m: 'button#pay.primary "Pay now"' }]),
        tags: { step: "checkout", plan: pick(["pro", "team"]) },
      };
    case "cart500":
      return {
        type: "HttpError", message: "GET /api/cart 500", level: "error" as const,
        breadcrumbs: crumbs([{ k: "navigation", m: "/pricing" }, { k: "click", m: 'a.btn "Add to cart"' }, { k: "fetch", m: "GET /api/cart 500 1204ms" }]),
        tags: { step: "cart" },
      };
    case "analytics":
      return {
        type: "ReferenceError", message: "analytics is not defined", level: "error" as const,
        frames: [{ fn: "n", file: `https://${d}/assets/vendor.b17c33aa.js`, line: 1, col: 3320, inApp: true }, { fn: "i", file: `https://${d}/assets/vendor.b17c33aa.js`, line: 1, col: 880, inApp: true }],
        breadcrumbs: crumbs([{ k: "navigation", m: "/" }, { k: "click", m: 'a.cta "Start free"' }]),
        tags: { step: "landing" },
      };
    case "timeout":
      return {
        type: "UnhandledRejection", message: "Request timed out after 30000ms", level: "warning" as const,
        frames: [{ fn: "s", file: `https://${d}/assets/app.4f2a9c1b.js`, line: 1, col: 9100, inApp: true }],
        breadcrumbs: crumbs([{ k: "fetch", m: "POST /api/events 504 30001ms" }]),
        tags: { step: "sync" },
      };
    case "email":
      return {
        type: "Error", message: `Checkout rejected for ${email}`, level: "error" as const,
        frames: [{ fn: "o", file: `https://${d}/assets/app.4f2a9c1b.js`, line: 1, col: 7010, inApp: true }],
        breadcrumbs: crumbs([{ k: "navigation", m: "/checkout" }, { k: "fetch", m: "POST /api/pay 402 410ms" }]),
        tags: { step: "payment" },
      };
  }
}

/** One visit by one person. Returns its events, oldest first. */
function makeSession(startMs: number, person: Person, opts: { creates?: boolean } = {}): EnrichedEvent[] {
  const out: EnrichedEvent[] = [];
  const release = releaseAt(startMs);
  const dayKey = new Date(startMs).toISOString().slice(0, 10);
  const sessionId = `s_${id(14)}`;
  const visitorId = `v_${dayKey}_${person.userId ?? id(8)}`; // the real pseudonym rotates daily, so does this
  const v = person.visitor;
  const src = weighted(SOURCES);
  const identified = (properties: Record<string, string | number | boolean> = {}) =>
    ({ demo: true, ...(person.userId ? { distinctId: person.userId } : {}), ...properties }) as never;

  let t = startMs;
  const common = (path: string, extra: Record<string, unknown> = {}) => ({
    sessionId, visitorPseudonym: visitorId.length >= 8 ? visitorId : `${visitorId}_xxxx`,
    path, url: `https://${DOMAIN_HOLDER.domain}${path}`, title: TITLES.get(path) ?? "",
    release, browser: v.browser, os: v.os, device: v.device, country: v.country,
    ...(person.userId ? { userId: person.userId } : {}),
    ...extra,
  });

  // journey
  const length = Math.min(7, 1 + Math.floor(Math.log(1 - rand()) / Math.log(0.55)));
  const journey: string[] = [weighted(PAGES).p];
  while (journey.length < length) {
    const last = journey[journey.length - 1]!;
    if (last === "/pricing" && rand() < 0.3) journey.push(rand() < 0.5 ? "/signup" : "/checkout");
    else if (last === "/checkout" || last === "/checkout/success") break;
    else journey.push(weighted(PAGES).p);
  }
  if (opts.creates && !journey.includes("/signup")) journey.splice(Math.min(1, journey.length), 0, "/signup");
  if (person.userId && !opts.creates && rand() < 0.12 && !journey.includes("/checkout")) journey.push("/checkout");

  let purchased = false;
  const safari153 = v.browser === "Safari" && release === REL.cur;
  const lcpBase = (v.device === "desktop" ? 1700 : 2600) * (release === REL.cur ? 1.07 : 1);

  journey.forEach((path, index) => {
    const first = index === 0;
    out.push(baseEvent({
      type: "pageview", _t: t,
      ...common(path, first ? { referrer: src.ref, ...(src.utm ? { campaign: src.utm } : {}) } : {}),
      properties: identified(),
    } as never));

    if (first && rand() < 0.55) {
      for (const [name, value] of [
        ["TTFB", between(180, 950)], ["FCP", lcpBase * between(0.4, 0.8)], ["LCP", lcpBase * (0.55 + rand() * 0.95) * (rand() < 0.07 ? 2.2 : 1)],
        ["CLS", rand() < 0.8 ? between(0, 0.09) : between(0.1, 0.3)], ["INP", between(60, 380)],
      ] as const) {
        const v2 = name === "CLS" ? Math.round(value * 1000) / 1000 : Math.round(value);
        out.push(baseEvent({ type: "web_vital", _t: t + 600, ...common(path), webVital: { name, value: v2, rating: rating(name, v2), navigationType: "navigate" } } as never));
      }
    }

    const event = (name: string, props: Record<string, string | number | boolean> = {}, at = t + 1500) =>
      out.push(baseEvent({ type: "custom", _t: at, ...common(path), properties: identified({ eventName: name, ...props }) } as never));

    if (path === "/pricing" && rand() < 0.25) event("select_plan", { plan: pick(["pro", "team"]) });
    if (path.startsWith("/blog") && rand() < 0.5) event("scroll_depth", { depth: pick([50, 75, 100]) }, t + 6000);
    if (rand() < 0.04) event("outbound_click", { url: "https://github.com/acme/analytics" }, t + 9000);
    if (rand() < 0.01) event("file_download", { file: "whitepaper.pdf" }, t + 9500);
    if (path === "/signup" && opts.creates) event("signup", { plan: String(person.traits.plan ?? "free") }, t + 4000);

    if (path === "/checkout") {
      const breaks = safari153 ? rand() < 0.5 : release === REL.cur && rand() < 0.04;
      if (breaks) {
        out.push(baseEvent({ type: "error", _t: t + 3500, ...common(path), error: errorPayload("items", t + 3500, "") } as never));
      } else if (rand() < (safari153 ? 0.08 : 0.3)) {
        purchased = true;
        event("purchase", { plan: pick(["pro", "team"]), amount: pick([29, 99]) }, t + 5000);
      }
    }
    if (path === "/checkout/success") purchased = true;

    out.push(baseEvent({ type: "engagement", _t: t + 8000, ...common(path), properties: identified({ engagementMs: Math.round(journey.length === 1 && rand() < 0.55 ? between(1200, 8000) : between(11000, rand() < 0.1 ? 240000 : 70000)) }) } as never));
    t += Math.round(between(15_000, 95_000));
  });

  if (purchased && !journey.includes("/checkout/success")) {
    out.push(baseEvent({ type: "pageview", _t: t, ...common("/checkout/success"), properties: identified() } as never));
  }

  if (opts.creates) {
    const traits = person.traits;
    out.splice(Math.min(3, out.length), 0, baseEvent({
      type: "identify", _t: startMs + 5000, ...common("/signup"),
      userTraits: traits as never, userId: person.userId!,
      properties: { demo: true, eventName: "$identify", distinctId: person.userId!, ...traits } as never,
    } as never));
  }

  // 1.2.0 on Safari: a cart widget that loads on every page throws for a good share of visits
  if (safari153 && rand() < 0.3) {
    const at = startMs + Math.round(between(2000, 9000));
    out.push(baseEvent({ type: "error", _t: at, ...common(journey[0]!), error: errorPayload("items", at, "") } as never));
  }

  // other issues, at a plausible moment of the visit
  const errorAt = startMs + Math.round(between(4000, 30000));
  const err = (kind: Parameters<typeof errorPayload>[0]) =>
    out.push(baseEvent({ type: "error", _t: errorAt, ...common(journey[Math.min(1, journey.length - 1)]!), error: errorPayload(kind, errorAt, `${person.userId ?? "visitor"}@example.com`) } as never));
  if (release === REL.old && rand() < 0.02) err("analytics");
  if (release !== REL.old && rand() < 0.012) err("cart500");
  if (rand() < 0.005) err("timeout");
  if (release !== REL.old && rand() < 0.004) err("email");

  return out.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}

/* ───────────────────────────── traffic plan ───────────────────────────── */
function buildTraffic(): EnrichedEvent[] {
  const events: EnrichedEvent[] = [];
  const startOfToday = new Date(new Date(NOW).toISOString().slice(0, 10) + "T00:00:00Z").getTime();

  // identified users: when they appeared, and which days they came back
  const people: Array<{ person: Person; created: number; days: number[] }> = [];
  for (let n = 1; n <= 320; n += 1) {
    const daysAgo = Math.floor((HISTORY_DAYS - 1) * Math.pow(rand(), 1.6));
    const plan = rand() < 0.65 ? "free" : rand() < 0.7 ? "pro" : "team";
    const visitor = newVisitor();
    const person: Person = {
      userId: `demo-user-${String(n).padStart(3, "0")}`,
      traits: { plan, company: pick(COMPANIES), role: pick(ROLES), seats: plan === "team" ? Math.floor(between(5, 40)) : 1 },
      visitor,
    };
    const days = [daysAgo];
    for (let back = daysAgo - 1; back >= 0; back -= 1) {
      const k = daysAgo - back;
      const p = Math.min(0.9, (0.5 * Math.exp(-k / 5) + 0.1 + (k % 7 === 0 ? 0.1 : 0)) * (plan === "free" ? 1 : 1.3));
      if (rand() < p) days.push(back);
    }
    people.push({ person, created: daysAgo, days });
  }

  const perDayIdentified = new Map<number, number>();
  for (const { person, days } of people) {
    for (const daysAgo of days) {
      const dayStart = startOfToday - daysAgo * DAY;
      const sessions = rand() < 0.25 ? 2 : 1;
      for (let s = 0; s < sessions; s += 1) {
        const t = dayStart + Math.round(between(6, 22) * 3_600_000);
        if (t > NOW - 60_000) continue;
        events.push(...makeSession(t, person, { creates: daysAgo === days[0] && s === 0 }));
        perDayIdentified.set(daysAgo, (perDayIdentified.get(daysAgo) ?? 0) + 1);
      }
    }
  }

  // anonymous visitors fill each day up to the day's traffic
  for (let daysAgo = HISTORY_DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
    const dayStart = startOfToday - daysAgo * DAY;
    const weekend = [0, 6].includes(new Date(dayStart).getUTCDay());
    const target = Math.round((180 + (HISTORY_DAYS - daysAgo) * 3) * (weekend ? 0.7 : 1) * (daysAgo <= 5 ? 3.4 : 1));
    const need = Math.max(30, target - (perDayIdentified.get(daysAgo) ?? 0));
    for (let i = 0; i < need; i += 1) {
      const hour = rand() < 0.6 ? between(11, 19) : between(0, 24);
      const t = dayStart + Math.round(hour * 3_600_000);
      if (t > NOW - 60_000) continue;
      events.push(...makeSession(t, { userId: null, traits: {}, visitor: newVisitor() }));
    }
  }
  return events;
}

/* ───────────────────────────── source map ───────────────────────────── */
async function writeSourceMap(siteId: string): Promise<string> {
  const { SourceMapGenerator } = createRequire(path.resolve(here, "../../apps/web/package.json"))("source-map") as typeof import("source-map");
  const g = new SourceMapGenerator({ file: "app.4f2a9c1b.js" });
  // A source map's `name` at a position is what is CALLED there, so each frame is named by the position of its caller.
  g.addMapping({ generated: { line: 1, column: 51 }, original: { line: 18, column: 10 }, source: "webpack://shop/./src/cart/validateCart.ts" });
  g.addMapping({ generated: { line: 1, column: 143 }, original: { line: 42, column: 16 }, source: "webpack://shop/./src/checkout/submitOrder.ts", name: "validateCart" });
  g.addMapping({ generated: { line: 1, column: 511 }, original: { line: 77, column: 6 }, source: "webpack://shop/./src/checkout/CheckoutButton.tsx", name: "submitOrder" });
  const dir = path.resolve(here, "../../apps/web/.data/objects");
  await new FileSystemObjectStore(dir).put(mapKey(siteId, REL.cur, MIN_FILE), new TextEncoder().encode(g.toString()));
  return dir;
}

/* ───────────────────────────── removal ───────────────────────────── */
const EXTRA_AGG: Array<{ table: string; column: string }> = [
  { table: "user_active_day", column: "date" }, { table: "user_first_day", column: "first_day" }, { table: "user_event_day", column: "date" },
  { table: "identity_map", column: "linked_at" }, { table: "session_summary_agg", column: "date" }, { table: "user_timeline", column: "ts" },
  { table: "metric_rollup_hour", column: "bucket" }, { table: "metric_rollup_day", column: "bucket" }, { table: "metric_rollup_minute", column: "bucket" },
  { table: "error_group_daily", column: "date" },
];
const DEMO_GOALS = ["Signup", "Purchase"];
const DEMO_FUNNELS = ["Signup funnel", "Checkout funnel"];
const DEMO_SEGMENTS = ["Pro and team users", "Active this month"];

async function mutate(query: string): Promise<void> {
  // allow_nondeterministic_mutations: some deletes select the ids to remove from the same table first.
  await ch.command({ query, clickhouse_settings: { mutations_sync: 2, allow_nondeterministic_mutations: 1 } });
}

async function remove(siteId: string, redis: Redis): Promise<void> {
  const since = new Date(NOW - (HISTORY_DAYS + 1) * DAY).toISOString().slice(0, 10);
  const site = `site_id = '${siteId}'`;
  const demo = `${site} AND JSONExtractBool(properties_json, 'demo')`;
  console.log("Removing demo data…");
  const groups = (await (await ch.query({ query: `SELECT DISTINCT toString(group_id) AS g FROM ${DB}.error_events WHERE ${site} AND release LIKE 'web@1.%'`, format: "JSONEachRow" })).json()) as Array<{ g: string }>;
  await mutate(`DELETE FROM ${DB}.web_vitals WHERE ${site} AND event_id IN (SELECT event_id FROM ${DB}.events_raw WHERE ${demo})`);
  await mutate(`DELETE FROM ${DB}.events_raw WHERE ${demo}`);
  await mutate(`DELETE FROM ${DB}.events_v2 WHERE ${demo}`);
  for (const t of ["error_events", "error_occurrences", "error_group_daily"]) await mutate(`DELETE FROM ${DB}.${t} WHERE ${site} AND release LIKE 'web@1.%'`).catch(() => undefined);
  if (groups.length > 0) await mutate(`DELETE FROM ${DB}.error_groups WHERE ${site} AND group_id IN (${groups.map((x) => x.g).join(",")})`);
  for (const { table, column } of [...RETENTION_TABLES.filter((t) => t.table !== "events_raw" && t.table !== "web_vitals" && t.table !== "events_v2"), ...EXTRA_AGG]) {
    const cond = `${site} AND ${column} >= ${column.endsWith("_at") || column === "ts" || column === "last_seen" || column === "bucket" ? `toDateTime('${since} 00:00:00')` : `toDate('${since}')`}`;
    await mutate(`DELETE FROM ${DB}.${table} WHERE ${cond}`).catch((e) => console.log(`  skipped ${table}: ${String(e).slice(0, 70)}`));
  }
  await db.delete(goals).where(and(eq(goals.siteId, siteId), inArray(goals.name, DEMO_GOALS)));
  await db.delete(siteFunnels).where(and(eq(siteFunnels.siteId, siteId), inArray(siteFunnels.name, DEMO_FUNNELS)));
  await db.delete(siteSegments).where(and(eq(siteSegments.siteId, siteId), inArray(siteSegments.name, DEMO_SEGMENTS)));
  await db.delete(siteReleases).where(and(eq(siteReleases.siteId, siteId), inArray(siteReleases.version, Object.values(REL))));
  if (groups.length > 0) await db.delete(siteErrorStatus).where(and(eq(siteErrorStatus.siteId, siteId), inArray(siteErrorStatus.groupId, groups.map((x) => x.g))));
  const keys = await redis.keys(`errocc:${siteId}:*`);
  if (keys.length > 0) await redis.del(...keys);
  await new FileSystemObjectStore(path.resolve(here, "../../apps/web/.data/objects")).delete(mapKey(siteId, REL.cur, MIN_FILE)).catch(() => undefined);
  console.log("Done. Re-running the rollup job rebuilds the legacy rollups from the events that remain.");
  await runDailyRollups().catch(() => undefined);
}

/* ───────────────────────────── main ───────────────────────────── */
async function main(): Promise<void> {
  const [site] = await db.select({ id: sites.id, workspaceId: sites.workspaceId, domain: sites.domain }).from(sites).where(eq(sites.publicKey, SITE_KEY)).limit(1);
  if (!site) throw new Error(`No site with the public key ${SITE_KEY}`);
  Object.assign(DOMAIN_HOLDER, { domain: site.domain, siteId: site.id, workspaceId: site.workspaceId });
  const redis = new Redis(env.REDIS_STATE_URL, { maxRetriesPerRequest: 2 });

  try {
    if (REMOVE) return await remove(site.id, redis);

    if (LIVE) {
      const write = createClickHouseWriter({ client: ch as never, asyncInsert: false, flushIntervalMs: 1000, writeMode: "shadow", onV2Error: (e) => console.error("v2 write failed:", e) });
      const live: EnrichedEvent[] = [];
      for (let n = 0; n < 9; n += 1) {
        live.push(...makeSession(Date.now() - Math.round(between(10_000, 200_000)), { userId: null, traits: {}, visitor: newVisitor() }).filter((e) => e.type === "pageview" || e.type === "custom"));
      }
      const stamped = live.map((e) => ({ ...e, receivedAt: new Date().toISOString() }) as EnrichedEvent);
      await write(stamped);
      await updateRealtimeState(redis, stamped);
      console.log(`Added ${stamped.length} live events from 9 sessions. Open the Realtime page now.`);
      return;
    }

    const existing = (await (await ch.query({ query: `SELECT count() AS n FROM ${DB}.events_raw WHERE site_id = '${site.id}' AND JSONExtractBool(properties_json, 'demo')`, format: "JSONEachRow" })).json()) as Array<{ n: string }>;
    if (Number(existing[0]?.n ?? 0) > 0) {
      if (!RESEED) throw new Error(`Demo data is already there (${existing[0]!.n} events). Use --reseed to replace it or --remove to delete it.`);
      await remove(site.id, redis);
    }

    console.log(`Seeding ${site.domain} (${site.id})…`);
    const raw = buildTraffic();
    const prepared = prepareErrorEvents(raw);
    // Mark the error events too (the error path replaces their properties), so --remove can find them.
    const events = prepared.events.map((e) => (e.type === "error" ? ({ ...e, properties: { ...(e.properties ?? {}), demo: true } } as EnrichedEvent) : e));
    console.log(`  ${events.length.toLocaleString()} events, ${prepared.rows.length.toLocaleString()} errors`);

    const write = createClickHouseWriter({ client: ch as never, asyncInsert: false, flushIntervalMs: 1000, writeMode: "shadow", onV2Error: (e) => console.error("v2 write failed:", e) });
    for (let i = 0; i < events.length; i += 2000) {
      await write(events.slice(i, i + 2000));
      process.stdout.write(`\r  written ${Math.min(i + 2000, events.length).toLocaleString()} / ${events.length.toLocaleString()}`);
    }
    process.stdout.write("\n");

    const writeErrors = createErrorWriter({ client: ch as never, redis: redis as never });
    for (let i = 0; i < prepared.rows.length; i += 1000) {
      await writeErrors({ events: [], rows: prepared.rows.slice(i, i + 1000), occurrences: prepared.occurrences.slice(i, i + 1000) });
    }
    await new Promise((r) => setTimeout(r, 2500));

    // live sessions for the Realtime page (they expire after five minutes)
    const live: EnrichedEvent[] = [];
    for (let n = 0; n < 9; n += 1) {
      live.push(...makeSession(NOW - Math.round(between(10_000, 200_000)), { userId: null, traits: {}, visitor: newVisitor() }).filter((e) => e.type === "pageview" || e.type === "custom"));
    }
    const liveStamped = live.map((e) => ({ ...e, receivedAt: new Date().toISOString() }) as EnrichedEvent);
    await write(liveStamped);
    await updateRealtimeState(redis, liveStamped);

    // Postgres: goals, funnels, segments, reported deploys
    await db.insert(goals).values([
      { workspaceId: site.workspaceId, siteId: site.id, name: "Signup", type: "custom_event", eventName: "signup" },
      { workspaceId: site.workspaceId, siteId: site.id, name: "Purchase", type: "custom_event", eventName: "purchase", targetValue: "59.00" },
    ]);
    await db.insert(siteFunnels).values([
      { siteId: site.id, name: "Signup funnel", description: "From landing to a created account", steps: [
        { order: 1, name: "Home", type: "pageview", target: "/" }, { order: 2, name: "Pricing", type: "pageview", target: "/pricing" },
        { order: 3, name: "Signup page", type: "pageview", target: "/signup" }, { order: 4, name: "Account created", type: "custom_event", target: "signup" } ] },
      { siteId: site.id, name: "Checkout funnel", description: "Browse to purchase", steps: [
        { order: 1, name: "Pricing", type: "pageview", target: "/pricing" }, { order: 2, name: "Checkout", type: "pageview", target: "/checkout" },
        { order: 3, name: "Purchase", type: "custom_event", target: "purchase" } ] },
    ]);
    await db.insert(siteSegments).values([
      { siteId: site.id, name: "Pro and team users", definition: { match: "any", conditions: [{ field: "trait", key: "plan", op: "eq", value: "pro" }, { field: "trait", key: "plan", op: "eq", value: "team" }], behavior: [] } },
      { siteId: site.id, name: "Active this month", definition: { match: "all", conditions: [{ field: "lastSeen", op: "within", days: 30 }], behavior: [] } },
    ]);
    await db.insert(siteReleases).values([
      { siteId: site.id, version: REL.mid, commit: "a91c3e07", environment: "production", deployedAt: new Date(DEPLOY_MID) },
      { siteId: site.id, version: REL.cur, commit: "7be25d44", environment: "production", deployedAt: new Date(DEPLOY_CUR) },
    ]);

    // issue statuses: one resolved (and gone), one ignored, one resolved and then back in 1.2.0
    const byTitle = (needle: string) => prepared.rows.find((r) => r.title.includes(needle))?.group_id;
    const resolved = byTitle("analytics is not defined");
    const ignored = byTitle("timed out");
    const back = byTitle("GET /api/cart 500");
    const statusRows = [
      resolved && { siteId: site.id, groupId: resolved, status: "resolved", mode: "now", resolvedAt: new Date(NOW - 11 * DAY) },
      ignored && { siteId: site.id, groupId: ignored, status: "ignored", mode: "now" },
      back && { siteId: site.id, groupId: back, status: "open", mode: "now", regressedAt: new Date(NOW - 1.5 * DAY), regressedIn: REL.cur },
    ].filter(Boolean) as Array<typeof siteErrorStatus.$inferInsert>;
    if (statusRows.length > 0) await db.insert(siteErrorStatus).values(statusRows);

    const storeDir = await writeSourceMap(site.id);
    console.log(`  source map written to ${storeDir}`);

    console.log("  running rollups for every seeded day…");
    await runHourlyRollups();
    for (let d = HISTORY_DAYS; d >= 0; d -= 1) {
      const day = new Date(NOW - d * DAY).toISOString().slice(0, 10);
      for (const group of GROUPS) for (const query of group.statements) await ch.command({ query, query_params: { day } });
    }

    const [workspace] = await db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, site.workspaceId)).limit(1);
    const base = `http://localhost:3000/${workspace!.slug}/sites/${site.domain}`;
    console.log(`\nDone. Open:\n  ${base}/errors\n  ${base}/releases\n  ${base}/retention\n  ${base}/people   (open any demo-user-… and use the Timeline tab)\n  ${base}/funnels\n  ${base}/events\n  ${base}/vitals  /pages  /journeys  /acquisition  /geography  /realtime`);
    console.log("\nRealtime shows the live sessions for about five minutes. Remove everything with: node --import tsx seed-suite-demo.mts --remove");
  } finally {
    redis.disconnect();
  }
}

main().then(() => process.exit(0), (error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
