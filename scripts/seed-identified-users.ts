/**
 * Seeds identified users and richer multi-page journeys, so User Profiles, segments, the
 * session replay, funnels and the Journeys page have something real to show.
 *
 *   pnpm seed:identified                      # workspace "demo1" (the seeded demo site)
 *   SEED_WORKSPACE=my-slug pnpm seed:identified
 *   SEED_SITE_KEY=site_pub_... pnpm seed:identified
 *   SEED_REMOVE=1 SEED_WORKSPACE=my-slug pnpm seed:identified   # take the seeded data back out
 *
 * Everything it writes is recognisable (distinct IDs start with "demo_usr_", sessions with
 * "dsess_", visitors with "dvis_", emails end in ".example") and every run starts by
 * removing the previous run's rows, so it is safe to run again. Other data is untouched.
 * Seed a throwaway site, not one that receives real traffic.
 */
import crypto from "node:crypto";
import { db, sites, workspaces, siteUserProfiles, and, eq, sql } from "@trackme/db";
import { getClickHouseClient } from "@trackme/analytics";

/* ───────────── deterministic randomness, so two runs build the same people ───────────── */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261018);
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const between = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const chance = (p: number) => rand() < p;
function weighted<T extends { weight: number }>(items: readonly T[]): T {
  let t = rand() * items.reduce((s, i) => s + i.weight, 0);
  for (const item of items) {
    t -= item.weight;
    if (t <= 0) return item;
  }
  return items[0]!;
}
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
const uuid = () => {
  // Deterministic v4-shaped id (the column is a UUID, the value need only be unique).
  const h = hex(32).split("");
  h[12] = "4";
  h[16] = "89ab"[Math.floor(rand() * 4)]!;
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};

const chTime = (d: Date) => {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
};

/* ───────────── the site's pages ───────────── */

const TITLES: Record<string, string> = {
  "/": "TrackMe | Privacy-first SaaS Analytics",
  "/features": "TrackMe | Product Features & Tour",
  "/pricing": "TrackMe | Plans & Pricing",
  "/signup": "TrackMe | Create Your Free Account",
  "/onboarding": "TrackMe | Welcome, let's set up your site",
  "/dashboard": "TrackMe | Dashboard",
  "/settings": "TrackMe | Account Settings",
  "/checkout": "TrackMe | Checkout",
  "/checkout/success": "TrackMe | Payment confirmed",
  "/docs/getting-started": "TrackMe Docs | Quickstart Guide",
  "/docs/api": "TrackMe Docs | API Reference",
  "/changelog": "TrackMe | Changelog",
  "/customers": "TrackMe | Customer Stories",
  "/about": "TrackMe | About Us",
  "/contact": "TrackMe | Contact Sales & Enterprise",
  "/integrations": "TrackMe | Official Framework Integrations",
  "/blog/how-we-scaled-realtime-analytics": "TrackMe Blog | Scaling Real-time Analytics with ClickHouse",
};
const titleOf = (path: string) => TITLES[path] ?? `TrackMe | ${path}`;

/** Anonymous visitors: lots of branching routes so the flow diagram has something to show. */
const ANON_ROUTES: { weight: number; pages: string[]; signup?: boolean }[] = [
  { weight: 14, pages: ["/", "/features", "/pricing", "/signup"], signup: true },
  { weight: 12, pages: ["/", "/pricing", "/signup"], signup: true },
  { weight: 9, pages: ["/", "/pricing"] },
  { weight: 8, pages: ["/", "/features"] },
  { weight: 7, pages: ["/", "/customers", "/pricing", "/contact"] },
  { weight: 7, pages: ["/blog/how-we-scaled-realtime-analytics", "/docs/getting-started", "/docs/api", "/pricing"] },
  { weight: 6, pages: ["/docs/getting-started", "/docs/api", "/signup", "/onboarding"], signup: true },
  { weight: 6, pages: ["/changelog", "/features", "/pricing"] },
  { weight: 5, pages: ["/", "/about", "/contact"] },
  { weight: 5, pages: ["/", "/integrations", "/docs/api"] },
  { weight: 5, pages: ["/pricing", "/features", "/pricing", "/signup"], signup: true },
  { weight: 4, pages: ["/", "/features", "/customers", "/pricing", "/checkout"] },
  { weight: 4, pages: ["/docs/getting-started", "/pricing"] },
  { weight: 3, pages: ["/", "/pricing", "/contact"] },
  { weight: 3, pages: ["/changelog"] },
  { weight: 3, pages: ["/"] },
];

const SOURCES = [
  { weight: 30, referrer: "https://www.google.com/search", source: "google", medium: "organic", name: "" },
  { weight: 22, referrer: "https://github.com/topics/analytics", source: "github", medium: "referral", name: "dev_community_q4" },
  { weight: 14, referrer: "https://news.ycombinator.com/item?id=41829312", source: "hackernews", medium: "referral", name: "" },
  { weight: 11, referrer: "https://t.co/trackme_launch", source: "twitter", medium: "social", name: "autumn_launch_2026" },
  { weight: 9, referrer: "https://www.linkedin.com/feed/", source: "linkedin", medium: "social", name: "saas_scale_summit" },
  { weight: 6, referrer: "https://www.producthunt.com/posts/trackme", source: "producthunt", medium: "referral", name: "founder_newsletter_sep" },
  { weight: 8, referrer: "", source: "", medium: "", name: "" },
];

const GEOS = [
  { weight: 34, country: "US", cities: ["San Francisco", "New York", "Seattle", "Austin", "Chicago"] },
  { weight: 14, country: "DE", cities: ["Berlin", "Munich", "Hamburg"] },
  { weight: 12, country: "GB", cities: ["London", "Manchester", "Bristol"] },
  { weight: 12, country: "IN", cities: ["Bengaluru", "Mumbai", "Pune", "Hyderabad"] },
  { weight: 7, country: "CA", cities: ["Toronto", "Vancouver"] },
  { weight: 6, country: "FR", cities: ["Paris", "Lyon"] },
  { weight: 5, country: "JP", cities: ["Tokyo", "Osaka"] },
  { weight: 4, country: "NL", cities: ["Amsterdam"] },
  { weight: 3, country: "AU", cities: ["Sydney", "Melbourne"] },
  { weight: 3, country: "SG", cities: ["Singapore"] },
];

const DEVICES = [
  { weight: 42, device: "desktop", browser: "Chrome", os: "macOS" },
  { weight: 22, device: "desktop", browser: "Chrome", os: "Windows" },
  { weight: 9, device: "desktop", browser: "Safari", os: "macOS" },
  { weight: 5, device: "desktop", browser: "Firefox", os: "Linux" },
  { weight: 14, device: "mobile", browser: "Safari", os: "iOS" },
  { weight: 6, device: "mobile", browser: "Chrome", os: "Android" },
  { weight: 2, device: "tablet", browser: "Safari", os: "iOS" },
];

type Geo = { country: string; city: string };
const pickGeo = (): Geo => {
  const g = weighted(GEOS);
  return { country: g.country, city: pick(g.cities) };
};
type Device = { device: string; browser: string; os: string };
type Source = (typeof SOURCES)[number];

/* ───────────── event rows ───────────── */

interface Ctx {
  workspaceId: string;
  siteId: string;
  publicKey: string;
  domain: string;
}

type Row = Record<string, unknown>;

function eventRow(
  ctx: Ctx,
  at: Date,
  o: {
    type: "pageview" | "custom" | "identify";
    eventName?: string;
    sessionId: string;
    visitor: string;
    path: string;
    referrer: string;
    src: Source;
    geo: Geo;
    dev: Device;
    props?: Record<string, unknown>;
  }
): Row {
  const time = chTime(at);
  return {
    event_id: uuid(),
    schema_version: 1,
    workspace_id: ctx.workspaceId,
    site_id: ctx.siteId,
    site_key: ctx.publicKey,
    timestamp: time,
    received_at: time,
    type: o.type,
    event_name: o.type === "custom" && o.eventName ? o.eventName : o.type,
    session_id: o.sessionId,
    visitor_pseudonym: o.visitor,
    url: `https://${ctx.domain}${o.path}`,
    path: o.path,
    title: titleOf(o.path),
    referrer: o.referrer,
    campaign_source: o.src.source,
    campaign_medium: o.src.medium,
    campaign_name: o.src.name,
    campaign_term: "",
    campaign_content: "",
    country: o.geo.country,
    city: o.geo.city,
    browser: o.dev.browser,
    os: o.dev.os,
    device: o.dev.device,
    bot_status: "human",
    properties_json: JSON.stringify(o.props ?? {}),
  };
}

/** Seconds spent on a page before moving on: mostly short, sometimes a long read. */
const dwellMs = () => (chance(0.12) ? between(120, 380) : between(7, 70)) * 1000;

/* ───────────── identified users ───────────── */

const FIRST = ["Aarav", "Maya", "Liam", "Sofia", "Noah", "Ines", "Kenji", "Priya", "Elena", "Omar", "Hana", "Lucas", "Zara", "Mateo", "Anya", "Theo", "Nadia", "Ravi", "Greta", "Jonas", "Leila", "Marco", "Yuki", "Chloe", "Dev", "Isla", "Arjun", "Freya", "Tariq", "Mina", "Oscar", "Rhea"];
const LAST = ["Sharma", "Chen", "Okafor", "Muller", "Rossi", "Tanaka", "Patel", "Silva", "Novak", "Haddad", "Larsen", "Costa", "Kapoor", "Weber", "Nguyen", "Fischer", "Mehta", "Dubois", "Ito", "Khan"];
const COMPANIES = ["Northwind", "Acme Labs", "Globex", "Initech", "Umbra", "Hooli", "Soylent", "Vandelay", "Stark Digital", "Wayne Works", "Pied Piper", "Cyberdyne"];
const ROLES = ["Founder", "Engineer", "Marketer", "Analyst", "Product Manager", "Designer"];
const SIGNUP_SOURCES = ["google", "github", "hackernews", "twitter", "producthunt", "linkedin"];

type Archetype = "buyer" | "abandoner" | "sales" | "power" | "dormant" | "evaluator";

const ARCHETYPES: { kind: Archetype; count: number }[] = [
  { kind: "buyer", count: 16 },
  { kind: "abandoner", count: 8 },
  { kind: "sales", count: 8 },
  { kind: "power", count: 8 },
  { kind: "dormant", count: 8 },
  { kind: "evaluator", count: 8 },
];

interface PlannedVisit {
  pages: string[];
  /** Custom events fired after landing on a page: path -> [event, props] */
  actions: Record<string, [string, Record<string, unknown>]>;
  /** The visit during which the user logs in (identify() runs at this path). */
  identifyAt?: string;
}

interface Person {
  distinctId: string;
  name: string;
  email: string;
  traits: Record<string, unknown>;
  kind: Archetype;
  geo: Geo;
  primaryDevice: Device;
  src: Source;
  visits: PlannedVisit[];
  lastSeenDaysAgo: number;
}

function buildPerson(i: number, kind: Archetype): Person {
  const first = FIRST[i % FIRST.length]!;
  const last = pick(LAST);
  const company = pick(COMPANIES);
  const geo = pickGeo();
  const plan =
    kind === "buyer"
      ? chance(0.6) ? "starter" : "pro"
      : kind === "power"
      ? chance(0.6) ? "pro" : "enterprise"
      : kind === "sales"
      ? chance(0.6) ? "enterprise" : "pro"
      : "free";
  const distinctId = `demo_usr_${hex(6)}`;
  const email = `${first}.${last}@${company.toLowerCase().replace(/[^a-z]/g, "")}.example`.toLowerCase();
  const traits: Record<string, unknown> = {
    plan,
    company,
    role: pick(ROLES),
    country: geo.country,
    signup_source: pick(SIGNUP_SOURCES),
    seats: plan === "free" ? 1 : plan === "enterprise" ? between(20, 120) : between(2, 15),
    email_verified: kind !== "evaluator" || chance(0.5),
  };
  const planEvent: [string, Record<string, unknown>] = ["purchase_completed", { plan, billing: pick(["monthly", "annual"]) }];

  const visits: PlannedVisit[] = [];
  const addReturning = (n: number, pool: string[][]) => {
    for (let k = 0; k < n; k += 1) visits.push({ pages: pick(pool), actions: {} });
  };
  const appPool = [["/dashboard"], ["/dashboard", "/docs/api", "/dashboard"], ["/dashboard", "/settings"], ["/dashboard", "/changelog", "/dashboard"]];

  switch (kind) {
    case "buyer":
      visits.push({
        pages: ["/", "/features", "/pricing", "/signup"],
        actions: { "/signup": ["signup_completed", { plan: "free" }] },
        identifyAt: "/signup",
      });
      visits.push({ pages: ["/onboarding", "/dashboard"], actions: { "/onboarding": ["onboarding_completed", {}] } });
      visits.push({
        pages: ["/pricing", "/checkout", "/checkout/success", "/dashboard"],
        actions: { "/pricing": ["pricing_plan_selected", { plan }], "/checkout/success": planEvent },
      });
      addReturning(between(1, 4), appPool);
      break;
    case "abandoner":
      visits.push({
        pages: ["/", "/pricing", "/signup"],
        actions: { "/signup": ["signup_completed", { plan: "free" }] },
        identifyAt: "/signup",
      });
      visits.push({ pages: ["/onboarding", "/dashboard"], actions: {} });
      visits.push({ pages: ["/pricing", "/checkout"], actions: { "/pricing": ["pricing_plan_selected", { plan: "pro" }] } });
      if (chance(0.5)) visits.push({ pages: ["/dashboard", "/pricing", "/checkout"], actions: {} });
      break;
    case "sales":
      visits.push({
        pages: ["/", "/customers", "/pricing", "/contact"],
        actions: { "/contact": ["demo_requested", { team_size: between(20, 400) }] },
        identifyAt: "/contact",
      });
      visits.push({ pages: ["/dashboard", "/docs/api"], actions: {} });
      addReturning(between(1, 3), appPool);
      break;
    case "power":
      visits.push({
        pages: ["/docs/getting-started", "/signup", "/onboarding", "/dashboard"],
        actions: { "/signup": ["signup_completed", { plan: "free" }] },
        identifyAt: "/signup",
      });
      visits.push({ pages: ["/pricing", "/checkout", "/checkout/success", "/dashboard"], actions: { "/checkout/success": planEvent } });
      addReturning(between(5, 9), [
        ["/dashboard", "/docs/api", "/dashboard", "/settings"],
        ["/dashboard"],
        ["/dashboard", "/changelog"],
        ["/dashboard", "/docs/api"],
      ]);
      for (const v of visits.slice(3)) if (chance(0.5)) v.actions["/dashboard"] = ["report_exported", { format: pick(["csv", "pdf"]) }];
      break;
    case "dormant":
      visits.push({
        pages: ["/", "/features", "/signup"],
        actions: { "/signup": ["signup_completed", { plan: "free" }] },
        identifyAt: "/signup",
      });
      if (chance(0.6)) visits.push({ pages: ["/onboarding", "/dashboard"], actions: {} });
      break;
    case "evaluator":
      visits.push({
        pages: ["/docs/getting-started", "/docs/api", "/signup", "/onboarding", "/dashboard"],
        actions: { "/signup": ["signup_completed", { plan: "free" }] },
        identifyAt: "/signup",
      });
      if (chance(0.7)) addReturning(between(1, 2), [["/dashboard"], ["/docs/api", "/dashboard"]]);
      break;
  }

  const lastSeenDaysAgo =
    kind === "dormant" ? between(24, 55) : kind === "abandoner" ? between(1, 18) : chance(0.75) ? between(0, 6) : between(7, 20);

  return {
    distinctId,
    name: `${first} ${last}`,
    email,
    traits,
    kind,
    geo,
    primaryDevice: weighted(DEVICES),
    src: weighted(SOURCES),
    visits,
    lastSeenDaysAgo,
  };
}

interface PersonResult {
  person: Person;
  rows: Row[];
  sessions: number;
  firstSeen: Date;
  lastSeen: Date;
  anonymousId: string;
}

function simulatePerson(ctx: Ctx, person: Person, now: Date): PersonResult {
  const visitor = `dvis_${hex(12)}`;
  const rows: Row[] = [];
  const n = person.visits.length;

  // Place the visits backwards in time from the last one, a day or more apart.
  let cursor = now.getTime() - person.lastSeenDaysAgo * 86_400_000 - between(0, 20) * 3_600_000;
  const starts: number[] = new Array(n);
  for (let k = n - 1; k >= 0; k -= 1) {
    starts[k] = cursor;
    cursor -= between(30, 130) * 3_600_000; // 1.25 to 5.5 days between visits
  }

  let identified = false;
  person.visits.forEach((visit, k) => {
    const sessionId = `dsess_${hex(16)}`;
    const dev = k > 0 && chance(0.2) ? weighted(DEVICES) : person.primaryDevice;
    let t = starts[k]!;
    visit.pages.forEach((path, step) => {
      const at = new Date(t);
      const base = {
        sessionId,
        visitor,
        src: person.src,
        geo: person.geo,
        dev,
        referrer: step === 0 ? (k === 0 ? person.src.referrer : chance(0.5) ? "" : `https://${ctx.domain}/`) : `https://${ctx.domain}${visit.pages[step - 1]}`,
      };
      const idProps = identified ? { distinctId: person.distinctId } : undefined;
      rows.push(eventRow(ctx, at, { ...base, type: "pageview", path, ...(idProps ? { props: idProps } : {}) }));

      const action = visit.actions[path];
      if (action) {
        const [eventName, props] = action;
        rows.push(
          eventRow(ctx, new Date(t + between(4, 14) * 1000), {
            ...base,
            type: "custom",
            eventName,
            path,
            props: { ...props, ...(identified ? { distinctId: person.distinctId } : {}) },
          })
        );
      }
      if (visit.identifyAt === path && !identified) {
        identified = true;
        rows.push(
          eventRow(ctx, new Date(t + between(10, 22) * 1000), {
            ...base,
            type: "identify",
            path,
            props: { eventName: "$identify", distinctId: person.distinctId, name: person.name, email: person.email, ...person.traits },
          })
        );
      }
      t += dwellMs();
    });
  });

  const times = rows.map((r) => new Date(String(r.timestamp).replace(" ", "T") + "Z").getTime());
  return {
    person,
    rows,
    sessions: n,
    firstSeen: new Date(Math.min(...times)),
    lastSeen: new Date(Math.max(...times)),
    anonymousId: visitor,
  };
}

/* ───────────── anonymous traffic ───────────── */

function simulateAnonymous(ctx: Ctx, now: Date, sessions: number): Row[] {
  const rows: Row[] = [];
  const returning = Array.from({ length: 140 }, () => `dvis_${hex(12)}`);
  for (let s = 0; s < sessions; s += 1) {
    const route = weighted(ANON_ROUTES);
    const visitor = chance(0.25) ? pick(returning) : `dvis_${hex(12)}`;
    const sessionId = `dsess_${hex(16)}`;
    const geo = pickGeo();
    const dev = weighted(DEVICES);
    const src = weighted(SOURCES);
    const dayAgo = Math.floor(Math.pow(rand(), 1.3) * 30);
    const start = new Date(now.getTime() - dayAgo * 86_400_000 - between(0, 23) * 3_600_000 - between(0, 59) * 60_000);
    if (start.getTime() > now.getTime() - 60_000) continue;
    let t = start.getTime();
    route.pages.forEach((path, step) => {
      const base = {
        sessionId,
        visitor,
        src,
        geo,
        dev: { device: dev.device, browser: dev.browser, os: dev.os },
        referrer: step === 0 ? src.referrer : `https://${ctx.domain}${route.pages[step - 1]}`,
      };
      rows.push(eventRow(ctx, new Date(t), { ...base, type: "pageview", path }));
      if (route.signup && path === "/signup" && chance(0.55)) {
        rows.push(
          eventRow(ctx, new Date(t + between(8, 25) * 1000), {
            ...base,
            type: "custom",
            eventName: "signup_completed",
            path,
            props: { plan: "free" },
          })
        );
      }
      t += dwellMs();
    });
  }
  return rows;
}

/* ───────────── write ───────────── */

/**
 * Recomputes the daily and hourly rollups for the site from events_raw. They are keyed
 * ReplacingMergeTree tables, so this replaces rows rather than adding to them.
 */
async function rebuildRollups(ch: ReturnType<typeof getClickHouseClient>, ctx: Ctx) {
  const rollupScope = `workspace_id = '${ctx.workspaceId}' AND site_id = '${ctx.siteId}' AND bot_status = 'human'`;
  await ch.command({
    query: `
      INSERT INTO pageview_rollups_daily (workspace_id, site_id, date, path, referrer, country, browser, device, campaign_source, campaign_medium, campaign_name, pageviews, unique_visitors, unique_sessions)
      SELECT workspace_id, site_id, toDate(timestamp) AS date, path, referrer, country, browser, device, campaign_source, campaign_medium, campaign_name,
        countIf(type = 'pageview'), uniqExact(visitor_pseudonym), uniqExact(session_id)
      FROM events_raw WHERE ${rollupScope}
      GROUP BY workspace_id, site_id, date, path, referrer, country, browser, device, campaign_source, campaign_medium, campaign_name`,
  });
  await ch.command({
    query: `
      INSERT INTO pageview_rollups_hourly (workspace_id, site_id, hour_timestamp, path, referrer, country, browser, device, campaign_source, campaign_medium, campaign_name, pageviews, unique_visitors, unique_sessions)
      SELECT workspace_id, site_id, toStartOfHour(timestamp) AS hour_timestamp, path, referrer, country, browser, device, campaign_source, campaign_medium, campaign_name,
        countIf(type = 'pageview'), uniqExact(visitor_pseudonym), uniqExact(session_id)
      FROM events_raw WHERE ${rollupScope}
      GROUP BY workspace_id, site_id, hour_timestamp, path, referrer, country, browser, device, campaign_source, campaign_medium, campaign_name`,
  });
  await ch.command({
    query: `
      INSERT INTO session_engagement_daily (workspace_id, site_id, date, sessions, bounced_sessions, total_duration_seconds, pageviews)
      SELECT workspace_id, site_id, toDate(session_start) AS date, count(), countIf(pageview_count = 1), sum(duration_seconds), sum(pageview_count)
      FROM (
        SELECT workspace_id, site_id, session_id, min(timestamp) AS session_start,
          dateDiff('second', min(timestamp), max(timestamp)) AS duration_seconds, countIf(type = 'pageview') AS pageview_count
        FROM events_raw WHERE ${rollupScope}
        GROUP BY workspace_id, site_id, session_id
      )
      GROUP BY workspace_id, site_id, date`,
  });
  await ch.command({
    query: `
      INSERT INTO event_rollups_daily (workspace_id, site_id, date, event_name, total_count, unique_sessions, unique_visitors)
      SELECT workspace_id, site_id, toDate(timestamp) AS date, event_name, count(*), uniqExact(session_id), uniqExact(visitor_pseudonym)
      FROM events_raw WHERE ${rollupScope} AND type = 'custom'
      GROUP BY workspace_id, site_id, date, event_name`,
  });
}

async function main() {
  const where = process.env.SEED_SITE_KEY
    ? eq(sites.publicKey, process.env.SEED_SITE_KEY)
    : eq(workspaces.slug, process.env.SEED_WORKSPACE ?? "demo1");
  const [site] = await db
    .select({ id: sites.id, workspaceId: sites.workspaceId, domain: sites.domain, publicKey: sites.publicKey, workspace: workspaces.slug })
    .from(sites)
    .innerJoin(workspaces, eq(workspaces.id, sites.workspaceId))
    .where(where)
    .limit(1);
  if (!site) {
    console.error("No matching site. Set SEED_WORKSPACE (workspace slug) or SEED_SITE_KEY.");
    process.exit(1);
  }
  const ctx: Ctx = { workspaceId: site.workspaceId, siteId: site.id, publicKey: site.publicKey, domain: site.domain };
  console.log(`Seeding identified users into ${site.domain} (workspace "${site.workspace}", site ${site.id})`);

  const ch = getClickHouseClient();
  const scope = `workspace_id = '${ctx.workspaceId}' AND site_id = '${ctx.siteId}'`;

  // 1. Remove what an earlier run left, so this one replaces it.
  await db.delete(siteUserProfiles).where(and(eq(siteUserProfiles.siteId, ctx.siteId), sql`${siteUserProfiles.distinctId} LIKE 'demo\\_usr\\_%'`));
  await ch.command({
    query: `ALTER TABLE events_raw DELETE WHERE ${scope} AND startsWith(session_id, 'dsess_')`,
    clickhouse_settings: { mutations_sync: "1" },
  });
  console.log("  removed rows from a previous run");

  if (process.env.SEED_REMOVE) {
    // The rollups were computed from events that no longer exist. Clear this site's and
    // rebuild them from what remains, so no seeded page or event lingers in the Overview.
    for (const table of ["pageview_rollups_daily", "pageview_rollups_hourly", "session_engagement_daily", "event_rollups_daily"]) {
      await ch.command({ query: `ALTER TABLE ${table} DELETE WHERE ${scope}`, clickhouse_settings: { mutations_sync: "1" } });
    }
    await rebuildRollups(ch, ctx);
    console.log("  rollups rebuilt from the remaining events. Seeded data removed.");
    process.exit(0);
  }

  // 2. Build the people and their activity.
  const now = new Date();
  const people: PersonResult[] = [];
  let index = 0;
  for (const { kind, count } of ARCHETYPES) {
    for (let k = 0; k < count; k += 1) people.push(simulatePerson(ctx, buildPerson(index++, kind), now));
  }
  const anonymous = simulateAnonymous(ctx, now, 1400);
  const rows = [...people.flatMap((p) => p.rows), ...anonymous];
  console.log(`  ${people.length} identified users, ${rows.length} events (${anonymous.length} anonymous)`);

  // 3. Events.
  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await ch.insert({ table: "events_raw", values: rows.slice(i, i + CHUNK), format: "JSONEachRow" });
  }

  // 4. Profiles.
  for (const r of people) {
    const eventCount = r.rows.length;
    await db
      .insert(siteUserProfiles)
      .values({
        siteId: ctx.siteId,
        distinctId: r.person.distinctId,
        anonymousId: r.anonymousId,
        name: r.person.name,
        email: r.person.email,
        traits: r.person.traits,
        totalSessions: r.sessions,
        totalEvents: eventCount,
        firstSeenAt: r.firstSeen,
        lastSeenAt: r.lastSeen,
      })
      .onConflictDoUpdate({
        target: [siteUserProfiles.siteId, siteUserProfiles.distinctId],
        set: { name: r.person.name, email: r.person.email, traits: r.person.traits, totalSessions: r.sessions, totalEvents: eventCount, firstSeenAt: r.firstSeen, lastSeenAt: r.lastSeen },
      });
  }

  await rebuildRollups(ch, ctx);

  const byKind = new Map<string, number>();
  for (const r of people) byKind.set(r.person.kind, (byKind.get(r.person.kind) ?? 0) + 1);
  console.log("  profiles:", [...byKind.entries()].map(([k, v]) => `${k} ${v}`).join(", "));
  console.log(`\nDone. Open the "${site.workspace}" workspace: People, Journeys, Funnels and Overview now have data.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("seed-identified-users failed:", err);
  process.exit(1);
});
