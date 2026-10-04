/**
 * Comprehensive Test Data Seeder for TrackMe Dashboard
 * Populates PostgreSQL (goals), ClickHouse (events_raw, web_vitals, and rollups),
 * and Redis (live active visitors) with realistic SaaS traffic.
 */
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { db, sites, workspaces, goals, eq } from "@trackme/db";
import { getClickHouseClient } from "@trackme/analytics";

function toClickHouseDateTime64(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.` +
    `${pad(date.getUTCMilliseconds(), 3)}`
  );
}

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const PATH_CATALOG = [
  { path: "/", title: "TrackMe | Privacy-first SaaS Analytics", weight: 35 },
  { path: "/pricing", title: "TrackMe | Plans & Pricing", weight: 18 },
  { path: "/features", title: "TrackMe | Product Features & Tour", weight: 14 },
  { path: "/docs/getting-started", title: "TrackMe Docs | Quickstart Guide", weight: 12 },
  { path: "/blog/how-we-scaled-realtime-analytics", title: "TrackMe Blog | Scaling Real-time Analytics with ClickHouse", weight: 9 },
  { path: "/signup", title: "TrackMe | Create Your Free Account", weight: 6 },
  { path: "/contact", title: "TrackMe | Contact Sales & Enterprise", weight: 4 },
  { path: "/integrations", title: "TrackMe | Official Framework Integrations", weight: 2 },
] as const;

function weightedRandomPath(): { path: string; title: string } {
  const total = PATH_CATALOG.reduce((sum, item) => sum + item.weight, 0);
  let threshold = Math.random() * total;
  for (const item of PATH_CATALOG) {
    threshold -= item.weight;
    if (threshold <= 0) return { path: item.path, title: item.title };
  }
  return PATH_CATALOG[0]!;
}

const SOURCES = [
  { referrer: "https://www.google.com/search", source: "google", medium: "organic", name: "", weight: 32 },
  { referrer: "https://github.com/topics/analytics", source: "github", medium: "referral", name: "dev_community_q4", weight: 25 },
  { referrer: "https://news.ycombinator.com/item?id=41829312", source: "hackernews", medium: "referral", name: "", weight: 14 },
  { referrer: "https://t.co/trackme_launch", source: "twitter", medium: "social", name: "autumn_launch_2026", weight: 11 },
  { referrer: "https://www.linkedin.com/feed/", source: "linkedin", medium: "social", name: "saas_scale_summit", weight: 8 },
  { referrer: "https://www.producthunt.com/posts/trackme", source: "producthunt", medium: "referral", name: "founder_newsletter_sep", weight: 5 },
  { referrer: "", source: "", medium: "", name: "", weight: 5 },
] as const;

function weightedRandomSource() {
  const total = SOURCES.reduce((sum, item) => sum + item.weight, 0);
  let threshold = Math.random() * total;
  for (const item of SOURCES) {
    threshold -= item.weight;
    if (threshold <= 0) return item;
  }
  return SOURCES[0]!;
}

const GEO_CATALOG = [
  { country: "US", cities: ["San Francisco", "New York", "Seattle", "Austin", "Chicago"], weight: 40 },
  { country: "DE", cities: ["Berlin", "Munich", "Frankfurt", "Hamburg"], weight: 14 },
  { country: "GB", cities: ["London", "Manchester", "Edinburgh", "Bristol"], weight: 12 },
  { country: "IN", cities: ["Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Pune"], weight: 10 },
  { country: "CA", cities: ["Toronto", "Vancouver", "Montreal"], weight: 7 },
  { country: "FR", cities: ["Paris", "Lyon", "Marseille"], weight: 5 },
  { country: "JP", cities: ["Tokyo", "Osaka", "Kyoto"], weight: 4 },
  { country: "NL", cities: ["Amsterdam", "Rotterdam", "Utrecht"], weight: 3 },
  { country: "AU", cities: ["Sydney", "Melbourne", "Brisbane"], weight: 3 },
  { country: "SG", cities: ["Singapore"], weight: 2 },
] as const;

function weightedRandomGeo() {
  const total = GEO_CATALOG.reduce((sum, item) => sum + item.weight, 0);
  let threshold = Math.random() * total;
  for (const item of GEO_CATALOG) {
    threshold -= item.weight;
    if (threshold <= 0) {
      return { country: item.country, city: randomChoice(item.cities) };
    }
  }
  return { country: "US", city: "San Francisco" };
}

const DEVICE_PROFILES = [
  { device: "desktop" as const, browser: "Chrome", os: "macOS", weight: 42 },
  { device: "desktop" as const, browser: "Chrome", os: "Windows", weight: 20 },
  { device: "desktop" as const, browser: "Safari", os: "macOS", weight: 10 },
  { device: "desktop" as const, browser: "Firefox", os: "Linux", weight: 5 },
  { device: "mobile" as const, browser: "Safari", os: "iOS", weight: 14 },
  { device: "mobile" as const, browser: "Chrome", os: "Android", weight: 6 },
  { device: "tablet" as const, browser: "Safari", os: "iOS", weight: 3 },
] as const;

function weightedRandomDevice() {
  const total = DEVICE_PROFILES.reduce((sum, item) => sum + item.weight, 0);
  let threshold = Math.random() * total;
  for (const item of DEVICE_PROFILES) {
    threshold -= item.weight;
    if (threshold <= 0) return item;
  }
  return DEVICE_PROFILES[0]!;
}

// User journeys for multi-page sessions
const JOURNEY_PATTERNS = [
  ["/", "/pricing", "/signup"],
  ["/", "/features", "/pricing", "/signup"],
  ["/blog/how-we-scaled-realtime-analytics", "/docs/getting-started", "/pricing"],
  ["/docs/getting-started", "/pricing", "/signup"],
  ["/", "/features", "/pricing"],
  ["/", "/docs/getting-started"],
  ["/", "/features", "/contact"],
  ["/pricing", "/contact"],
  ["/", "/pricing"],
  ["/", "/blog/how-we-scaled-realtime-analytics"],
] as const;

async function seedGoalsForSite(workspaceId: string, siteId: string) {
  const defaultGoals = [
    {
      name: "Free Trial Signups",
      type: "custom_event",
      eventName: "signup_completed",
      pathPattern: null,
      targetValue: "500.00",
    },
    {
      name: "Pricing Views",
      type: "pageview_rule",
      eventName: null,
      pathPattern: "/pricing",
      targetValue: "2000.00",
    },
    {
      name: "Enterprise Demo Requests",
      type: "custom_event",
      eventName: "demo_requested",
      pathPattern: null,
      targetValue: "100.00",
    },
  ];

  for (const g of defaultGoals) {
    const existing = await db
      .select({ id: goals.id })
      .from(goals)
      .where(eq(goals.siteId, siteId))
      .limit(10);

    const alreadyExists = existing.some(() => false); // check by name
    const match = await db
      .select({ id: goals.id })
      .from(goals)
      .where(eq(goals.name, g.name))
      .limit(1);

    if (match.length === 0) {
      await db.insert(goals).values({
        workspaceId,
        siteId,
        name: g.name,
        type: g.type,
        eventName: g.eventName,
        pathPattern: g.pathPattern,
        targetValue: g.targetValue,
        enabled: true,
      });
    }
  }
}

async function seedSiteData(site: {
  id: string;
  workspaceId: string;
  domain: string;
  publicKey: string;
}) {
  const client = getClickHouseClient();
  const now = new Date(); // e.g. 2026-10-03/04
  console.log(`\n🌱 Seeding test data for site: ${site.domain} (id: ${site.id})...`);

  // 1. Seed PostgreSQL goals
  await seedGoalsForSite(site.workspaceId, site.id);
  console.log(`   ✓ Postgres goals ensured`);

  // 2. Generate 45 days of realistic sessions
  const DAYS = 45;
  const rawEventsBatch: any[] = [];
  const webVitalsBatch: any[] = [];

  // Pool of returning visitors
  const returningVisitors = Array.from({ length: 400 }, () => `vis_${crypto.randomBytes(8).toString("hex")}`);

  for (let dayOffset = DAYS; dayOffset >= 0; dayOffset--) {
    const dayDate = new Date(now.getTime() - dayOffset * 24 * 3600 * 1000);
    const dayOfWeek = dayDate.getUTCDay(); // 0 = Sun, 6 = Sat

    // Weekend traffic dip (~0.72x), midweek peak (~1.18x)
    const weekendMultiplier = dayOfWeek === 0 || dayOfWeek === 6 ? 0.72 : 1.15;
    // Growth trend: 45 days ago had ~110 sessions/day, today has ~230 sessions/day (+109% overall growth)
    const growthProgress = (DAYS - dayOffset) / DAYS;
    const baseDailySessions = Math.round((95 + growthProgress * 120) * weekendMultiplier);

    for (let s = 0; s < baseDailySessions; s++) {
      const isReturning = Math.random() < 0.28;
      const visitorPseudonym = isReturning
        ? randomChoice(returningVisitors)
        : `vis_${crypto.randomBytes(8).toString("hex")}`;
      const sessionId = `sess_${crypto.randomBytes(8).toString("hex")}`;

      const geo = weightedRandomGeo();
      const dev = weightedRandomDevice();
      const src = weightedRandomSource();

      // Session start time: realistic diurnal distribution across 24h
      // Peak hours: 9:00 - 18:00 UTC
      let hour: number;
      if (Math.random() < 0.65) {
        hour = randomBetween(9, 18);
      } else if (Math.random() < 0.85) {
        hour = randomBetween(19, 23);
      } else {
        hour = randomBetween(0, 8);
      }
      const minute = randomBetween(0, 59);
      const second = randomBetween(0, 59);

      const sessionStartTime = new Date(
        Date.UTC(
          dayDate.getUTCFullYear(),
          dayDate.getUTCMonth(),
          dayDate.getUTCDate(),
          hour,
          minute,
          second
        )
      );

      // Do not generate future events beyond current time
      if (sessionStartTime.getTime() > now.getTime()) {
        continue;
      }

      // Bounce determination: 38% bounce
      const isBounce = Math.random() < 0.38;

      if (isBounce) {
        // Single pageview
        const page = weightedRandomPath();
        const eventId = crypto.randomUUID();
        const chTime = toClickHouseDateTime64(sessionStartTime);

        rawEventsBatch.push({
          event_id: eventId,
          schema_version: 1,
          workspace_id: site.workspaceId,
          site_id: site.id,
          site_key: site.publicKey,
          timestamp: chTime,
          received_at: chTime,
          type: "pageview",
          event_name: "pageview",
          session_id: sessionId,
          visitor_pseudonym: visitorPseudonym,
          url: `https://${site.domain}${page.path}`,
          path: page.path,
          title: page.title,
          referrer: src.referrer,
          campaign_source: src.source,
          campaign_medium: src.medium,
          campaign_name: src.name,
          campaign_term: "",
          campaign_content: "",
          country: geo.country,
          city: geo.city,
          browser: dev.browser,
          os: dev.os,
          device: dev.device,
          bot_status: "human",
          properties_json: "{}",
        });

        // 30% sample of web vitals
        if (Math.random() < 0.35) {
          const lcp = randomBetween(1100, 2400);
          webVitalsBatch.push(
            {
              workspace_id: site.workspaceId,
              site_id: site.id,
              timestamp: chTime,
              path: page.path,
              metric_name: "LCP",
              metric_value: lcp,
              rating: lcp <= 2500 ? "good" : "needs-improvement",
              navigation_type: "navigate",
            },
            {
              workspace_id: site.workspaceId,
              site_id: site.id,
              timestamp: chTime,
              path: page.path,
              metric_name: "CLS",
              metric_value: Number((Math.random() * 0.05).toFixed(3)),
              rating: "good",
              navigation_type: "navigate",
            },
            {
              workspace_id: site.workspaceId,
              site_id: site.id,
              timestamp: chTime,
              path: page.path,
              metric_name: "INP",
              metric_value: randomBetween(35, 95),
              rating: "good",
              navigation_type: "navigate",
            },
            {
              workspace_id: site.workspaceId,
              site_id: site.id,
              timestamp: chTime,
              path: page.path,
              metric_name: "FCP",
              metric_value: randomBetween(600, 1400),
              rating: "good",
              navigation_type: "navigate",
            },
            {
              workspace_id: site.workspaceId,
              site_id: site.id,
              timestamp: chTime,
              path: page.path,
              metric_name: "TTFB",
              metric_value: randomBetween(90, 240),
              rating: "good",
              navigation_type: "navigate",
            }
          );
        }
      } else {
        // Multi-page journey
        const journey = randomChoice(JOURNEY_PATTERNS);
        let currentTime = new Date(sessionStartTime.getTime());

        for (let step = 0; step < journey.length; step++) {
          const path = journey[step]!;
          const pageConfig = PATH_CATALOG.find((p) => p.path === path) || {
            path,
            title: `TrackMe | ${path}`,
          };
          const eventId = crypto.randomUUID();
          const chTime = toClickHouseDateTime64(currentTime);

          rawEventsBatch.push({
            event_id: eventId,
            schema_version: 1,
            workspace_id: site.workspaceId,
            site_id: site.id,
            site_key: site.publicKey,
            timestamp: chTime,
            received_at: chTime,
            type: "pageview",
            event_name: "pageview",
            session_id: sessionId,
            visitor_pseudonym: visitorPseudonym,
            url: `https://${site.domain}${path}`,
            path,
            title: pageConfig.title,
            referrer: step === 0 ? src.referrer : `https://${site.domain}${journey[step - 1]}`,
            campaign_source: src.source,
            campaign_medium: src.medium,
            campaign_name: src.name,
            campaign_term: "",
            campaign_content: "",
            country: geo.country,
            city: geo.city,
            browser: dev.browser,
            os: dev.os,
            device: dev.device,
            bot_status: "human",
            properties_json: "{}",
          });

          // Web Vitals on pageview
          if (step === 0 && Math.random() < 0.4) {
            const lcp = randomBetween(1050, 2350);
            webVitalsBatch.push(
              {
                workspace_id: site.workspaceId,
                site_id: site.id,
                timestamp: chTime,
                path,
                metric_name: "LCP",
                metric_value: lcp,
                rating: lcp <= 2500 ? "good" : "needs-improvement",
                navigation_type: "navigate",
              },
              {
                workspace_id: site.workspaceId,
                site_id: site.id,
                timestamp: chTime,
                path,
                metric_name: "CLS",
                metric_value: Number((Math.random() * 0.04).toFixed(3)),
                rating: "good",
                navigation_type: "navigate",
              },
              {
                workspace_id: site.workspaceId,
                site_id: site.id,
                timestamp: chTime,
                path,
                metric_name: "INP",
                metric_value: randomBetween(30, 85),
                rating: "good",
                navigation_type: "navigate",
              },
              {
                workspace_id: site.workspaceId,
                site_id: site.id,
                timestamp: chTime,
                path,
                metric_name: "FCP",
                metric_value: randomBetween(550, 1250),
                rating: "good",
                navigation_type: "navigate",
              },
              {
                workspace_id: site.workspaceId,
                site_id: site.id,
                timestamp: chTime,
                path,
                metric_name: "TTFB",
                metric_value: randomBetween(80, 210),
                rating: "good",
                navigation_type: "navigate",
              }
            );
          }

          // Custom events during user interaction
          if (path === "/signup") {
            const signupEventId = crypto.randomUUID();
            const actionTime = new Date(currentTime.getTime() + 15000);
            rawEventsBatch.push({
              event_id: signupEventId,
              schema_version: 1,
              workspace_id: site.workspaceId,
              site_id: site.id,
              site_key: site.publicKey,
              timestamp: toClickHouseDateTime64(actionTime),
              received_at: toClickHouseDateTime64(actionTime),
              type: "custom",
              event_name: "signup_completed",
              session_id: sessionId,
              visitor_pseudonym: visitorPseudonym,
              url: `https://${site.domain}/signup`,
              path: "/signup",
              title: "TrackMe | Create Your Free Account",
              referrer: `https://${site.domain}/pricing`,
              campaign_source: src.source,
              campaign_medium: src.medium,
              campaign_name: src.name,
              campaign_term: "",
              campaign_content: "",
              country: geo.country,
              city: geo.city,
              browser: dev.browser,
              os: dev.os,
              device: dev.device,
              bot_status: "human",
              properties_json: JSON.stringify({
                plan: randomChoice(["starter", "growth", "pro"]),
                billing: randomChoice(["monthly", "annual"]),
              }),
            });
          } else if (path === "/pricing" && Math.random() < 0.6) {
            const planEventId = crypto.randomUUID();
            const actionTime = new Date(currentTime.getTime() + 12000);
            rawEventsBatch.push({
              event_id: planEventId,
              schema_version: 1,
              workspace_id: site.workspaceId,
              site_id: site.id,
              site_key: site.publicKey,
              timestamp: toClickHouseDateTime64(actionTime),
              received_at: toClickHouseDateTime64(actionTime),
              type: "custom",
              event_name: "pricing_plan_selected",
              session_id: sessionId,
              visitor_pseudonym: visitorPseudonym,
              url: `https://${site.domain}/pricing`,
              path: "/pricing",
              title: "TrackMe | Plans & Pricing",
              referrer: src.referrer,
              campaign_source: src.source,
              campaign_medium: src.medium,
              campaign_name: src.name,
              campaign_term: "",
              campaign_content: "",
              country: geo.country,
              city: geo.city,
              browser: dev.browser,
              os: dev.os,
              device: dev.device,
              bot_status: "human",
              properties_json: JSON.stringify({
                plan: randomChoice(["starter", "growth", "pro"]),
              }),
            });
          } else if (path === "/contact" && Math.random() < 0.45) {
            const demoEventId = crypto.randomUUID();
            const actionTime = new Date(currentTime.getTime() + 20000);
            rawEventsBatch.push({
              event_id: demoEventId,
              schema_version: 1,
              workspace_id: site.workspaceId,
              site_id: site.id,
              site_key: site.publicKey,
              timestamp: toClickHouseDateTime64(actionTime),
              received_at: toClickHouseDateTime64(actionTime),
              type: "custom",
              event_name: "demo_requested",
              session_id: sessionId,
              visitor_pseudonym: visitorPseudonym,
              url: `https://${site.domain}/contact`,
              path: "/contact",
              title: "TrackMe | Contact Sales & Enterprise",
              referrer: src.referrer,
              campaign_source: src.source,
              campaign_medium: src.medium,
              campaign_name: src.name,
              campaign_term: "",
              campaign_content: "",
              country: geo.country,
              city: geo.city,
              browser: dev.browser,
              os: dev.os,
              device: dev.device,
              bot_status: "human",
              properties_json: JSON.stringify({
                company_size: randomChoice(["10-50", "50-200", "200+"]),
              }),
            });
          } else if (path === "/" && Math.random() < 0.5) {
            const ctaEventId = crypto.randomUUID();
            const actionTime = new Date(currentTime.getTime() + 8000);
            rawEventsBatch.push({
              event_id: ctaEventId,
              schema_version: 1,
              workspace_id: site.workspaceId,
              site_id: site.id,
              site_key: site.publicKey,
              timestamp: toClickHouseDateTime64(actionTime),
              received_at: toClickHouseDateTime64(actionTime),
              type: "custom",
              event_name: "cta_clicked",
              session_id: sessionId,
              visitor_pseudonym: visitorPseudonym,
              url: `https://${site.domain}/`,
              path: "/",
              title: pageConfig.title,
              referrer: src.referrer,
              campaign_source: src.source,
              campaign_medium: src.medium,
              campaign_name: src.name,
              campaign_term: "",
              campaign_content: "",
              country: geo.country,
              city: geo.city,
              browser: dev.browser,
              os: dev.os,
              device: dev.device,
              bot_status: "human",
              properties_json: JSON.stringify({
                button: "start_free_trial",
                location: "hero",
              }),
            });
          }

          // Advance time by 25 to 75 seconds for next pageview in session
          currentTime = new Date(currentTime.getTime() + randomBetween(25, 75) * 1000);
        }
      }
    }
  }

  console.log(`   Generated ${rawEventsBatch.length} raw events and ${webVitalsBatch.length} web vitals`);

  // 3. Batch insert into ClickHouse events_raw
  const CHUNK_SIZE = 1500;
  for (let i = 0; i < rawEventsBatch.length; i += CHUNK_SIZE) {
    const chunk = rawEventsBatch.slice(i, i + CHUNK_SIZE);
    await client.insert({
      table: "events_raw",
      values: chunk,
      format: "JSONEachRow",
    });
  }
  console.log(`   ✓ Inserted ${rawEventsBatch.length} rows into events_raw`);

  // 4. Batch insert into ClickHouse web_vitals
  for (let i = 0; i < webVitalsBatch.length; i += CHUNK_SIZE) {
    const chunk = webVitalsBatch.slice(i, i + CHUNK_SIZE);
    await client.insert({
      table: "web_vitals",
      values: chunk,
      format: "JSONEachRow",
    });
  }
  console.log(`   ✓ Inserted ${webVitalsBatch.length} rows into web_vitals`);

  // 5. Populate Rollup tables in ClickHouse using SQL aggregation
  console.log(`   Aggregating rollups for site ${site.id}...`);

  // Daily pageviews rollup
  await client.command({
    query: `
      INSERT INTO pageview_rollups_daily (
        workspace_id, site_id, date, path, referrer, country, browser,
        device, campaign_source, campaign_medium, campaign_name,
        pageviews, unique_visitors, unique_sessions
      )
      SELECT
        workspace_id,
        site_id,
        toDate(timestamp) AS date,
        path,
        referrer,
        country,
        browser,
        device,
        campaign_source,
        campaign_medium,
        campaign_name,
        countIf(type = 'pageview') AS pageviews,
        uniqExact(visitor_pseudonym) AS unique_visitors,
        uniqExact(session_id) AS unique_sessions
      FROM events_raw
      WHERE workspace_id = '${site.workspaceId}'
        AND site_id = '${site.id}'
        AND bot_status = 'human'
      GROUP BY
        workspace_id, site_id, date, path, referrer, country, browser,
        device, campaign_source, campaign_medium, campaign_name
    `,
  });
  console.log(`   ✓ Populated pageview_rollups_daily`);

  // Hourly pageviews rollup
  await client.command({
    query: `
      INSERT INTO pageview_rollups_hourly (
        workspace_id, site_id, hour_timestamp, path, referrer, country,
        browser, device, campaign_source, campaign_medium, campaign_name,
        pageviews, unique_visitors, unique_sessions
      )
      SELECT
        workspace_id,
        site_id,
        toStartOfHour(timestamp) AS hour_timestamp,
        path,
        referrer,
        country,
        browser,
        device,
        campaign_source,
        campaign_medium,
        campaign_name,
        countIf(type = 'pageview') AS pageviews,
        uniqExact(visitor_pseudonym) AS unique_visitors,
        uniqExact(session_id) AS unique_sessions
      FROM events_raw
      WHERE workspace_id = '${site.workspaceId}'
        AND site_id = '${site.id}'
        AND bot_status = 'human'
      GROUP BY
        workspace_id, site_id, hour_timestamp, path, referrer, country,
        browser, device, campaign_source, campaign_medium, campaign_name
    `,
  });
  console.log(`   ✓ Populated pageview_rollups_hourly`);

  // Session engagement rollup
  await client.command({
    query: `
      INSERT INTO session_engagement_daily (
        workspace_id, site_id, date,
        sessions, bounced_sessions, total_duration_seconds, pageviews
      )
      SELECT
        workspace_id,
        site_id,
        toDate(session_start) AS date,
        count() AS sessions,
        countIf(pageview_count = 1) AS bounced_sessions,
        sum(duration_seconds) AS total_duration_seconds,
        sum(pageview_count) AS pageviews
      FROM (
        SELECT
          workspace_id,
          site_id,
          session_id,
          min(timestamp) AS session_start,
          dateDiff('second', min(timestamp), max(timestamp)) AS duration_seconds,
          countIf(type = 'pageview') AS pageview_count
        FROM events_raw
        WHERE workspace_id = '${site.workspaceId}'
          AND site_id = '${site.id}'
          AND bot_status = 'human'
        GROUP BY workspace_id, site_id, session_id
      )
      GROUP BY workspace_id, site_id, date
    `,
  });
  console.log(`   ✓ Populated session_engagement_daily`);

  // Event rollups daily
  await client.command({
    query: `
      INSERT INTO event_rollups_daily (
        workspace_id, site_id, date, event_name,
        total_count, unique_sessions, unique_visitors
      )
      SELECT
        workspace_id,
        site_id,
        toDate(timestamp) AS date,
        event_name,
        count(*) AS total_count,
        uniqExact(session_id) AS unique_sessions,
        uniqExact(visitor_pseudonym) AS unique_visitors
      FROM events_raw
      WHERE workspace_id = '${site.workspaceId}'
        AND site_id = '${site.id}'
        AND type = 'custom'
        AND bot_status = 'human'
      GROUP BY workspace_id, site_id, date, event_name
    `,
  });
  console.log(`   ✓ Populated event_rollups_daily`);

  // 6. Seed Redis with active realtime sessions
  seedRedisRealtime(site.id);
}

function seedRedisRealtime(siteId: string) {
  const activeCount = 18;
  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = 1800; // 30 minutes
  const expiry = nowSec + ttlSec;

  const activePages = [
    "/",
    "/pricing",
    "/features",
    "/docs/getting-started",
    "/signup",
    "/blog/how-we-scaled-realtime-analytics",
  ];

  const activeCountries = ["US", "DE", "GB", "IN", "CA", "FR", "NL"];

  try {
    // Clear previous realtime index for site
    execSync(`docker exec growth_redis redis-cli -a redis_dev_secret del rt:active:${siteId}`, { stdio: "ignore" });

    for (let i = 0; i < activeCount; i++) {
      const sessionId = `rt_sess_${crypto.randomBytes(6).toString("hex")}`;
      const path = randomChoice(activePages);
      const country = randomChoice(activeCountries);
      const payload = JSON.stringify({
        path,
        timestamp: new Date().toISOString(),
        country,
        device: randomChoice(["desktop", "desktop", "mobile"]),
      });

      // ZADD rt:active:{siteId} {expiry} {sessionId}
      execSync(
        `docker exec growth_redis redis-cli -a redis_dev_secret zadd rt:active:${siteId} ${expiry} ${sessionId}`,
        { stdio: "ignore" }
      );

      // SET active:{siteId}:{sessionId} {payload} EX 1800
      execSync(
        `docker exec growth_redis redis-cli -a redis_dev_secret set active:${siteId}:${sessionId} '${payload}' EX ${ttlSec}`,
        { stdio: "ignore" }
      );
    }

    console.log(`   ✓ Seeded ${activeCount} active realtime sessions in Redis`);
  } catch (err: any) {
    console.warn(`   ⚠️ Warning: Could not seed Redis realtime: ${err.message}`);
  }
}

async function main() {
  console.log("🚀 Starting TrackMe comprehensive test data seeder...");

  // Load all sites from Postgres
  const allSites = await db
    .select({
      id: sites.id,
      workspaceId: sites.workspaceId,
      domain: sites.domain,
      publicKey: sites.publicKey,
    })
    .from(sites);

  if (allSites.length === 0) {
    console.error("❌ No sites found in PostgreSQL database. Run pnpm seed:demo first.");
    process.exit(1);
  }

  console.log(`Found ${allSites.length} site(s) to seed:`, allSites.map((s) => `${s.domain} (${s.id})`));

  for (const site of allSites) {
    await seedSiteData(site);
  }

  console.log("\n🎉 All test data successfully seeded!");
  console.log("You can now test the UI across:");
  console.log(" - /saas-hu/overview (Overview Dashboard with Sparklines & KPIs)");
  console.log(" - /saas-hu/sites/localhost/pages (Pages Breakdown)");
  console.log(" - /saas-hu/sites/localhost/geography (World Map & Countries)");
  console.log(" - /saas-hu/sites/localhost/vitals (Core Web Vitals LCP/CLS/INP)");
  console.log(" - /saas-hu/sites/localhost/events (Events & Conversion Goals)");
  console.log(" - /saas-hu/sites/localhost/realtime (Live Active Visitors)");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
