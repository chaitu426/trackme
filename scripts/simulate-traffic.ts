/**
 * Synthetic traffic generator to simulate real-world events against the ingestion edge
 */
import crypto from "node:crypto";

const INGESTION_URL = process.env.INGESTION_URL || "http://localhost:3001/v1/batch";
const SITE_KEY = "site_pub_demo_test_key";

const PATHS = [
  "/",
  "/pricing",
  "/docs/quickstart",
  "/features",
  "/blog/privacy-first-analytics",
  "/contact",
];

const SOURCES = ["google", "twitter", "github", "direct", "linkedin"];
const MEDIUMS = ["organic", "social", "referral", "email", "cpc"];
const CAMPAIGNS = ["summer_launch", "dev_rel_q3", "newsletter_weekly"];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

async function sendBatch(): Promise<void> {
  const batchSize = Math.floor(Math.random() * 8) + 2;
  const events = [];

  for (let i = 0; i < batchSize; i++) {
    const sessionId = `sess_${crypto.randomBytes(8).toString("hex")}`;
    const visitorPseudonym = `vis_${crypto.randomBytes(8).toString("hex")}`;
    const path = randomChoice(PATHS);
    const source = randomChoice(SOURCES);
    const isCampaign = source !== "direct" && Math.random() > 0.4;

    const event = {
      schemaVersion: 1,
      eventId: crypto.randomUUID(),
      type: Math.random() > 0.15 ? "pageview" : "custom",
      occurredAt: new Date().toISOString(),
      siteKey: SITE_KEY,
      sessionId,
      visitorPseudonym,
      url: `https://acmesaas.com${path}`,
      path,
      title: `Acme SaaS | ${path}`,
      referrer: source === "direct" ? undefined : `https://${source}.com/link`,
      campaign: isCampaign
        ? {
            source,
            medium: randomChoice(MEDIUMS),
            campaign: randomChoice(CAMPAIGNS),
          }
        : undefined,
      properties: {
        eventName: path === "/pricing" ? "checkout_started" : "cta_clicked",
        plan: "growth",
      },
    };

    events.push(event);
  }

  try {
    const res = await fetch(INGESTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });

    if (res.ok) {
      console.log(`🚀 Successfully simulated and sent batch of ${events.length} events!`);
    } else {
      console.warn(`⚠️ Ingestion replied with status ${res.status}`);
    }
  } catch (err: any) {
    console.error(`❌ Could not connect to ingestion edge at ${INGESTION_URL}: ${err.message}`);
  }
}

async function main() {
  console.log("🚦 Starting synthetic traffic generator against:", INGESTION_URL);
  console.log("Sending 5 simulated batches (press Ctrl+C to stop)...");

  for (let i = 0; i < 5; i++) {
    await sendBatch();
    await new Promise((res) => setTimeout(res, 800));
  }

  console.log("🏁 Completed synthetic simulation run.");
}

main();

