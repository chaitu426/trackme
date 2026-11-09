/**
 * Demo payments for the Payments & Revenue pages, built on the checkout sessions the suite seeder already created.
 *
 *   node --import tsx seed-payments-demo.mts [--site-key=site_pub_...] [--reseed | --remove]
 *
 * Run seed-suite-demo.mts first. Every session that viewed /checkout may start a payment (an order_session row, exactly what
 * the browser's trackPayment would have produced), and each order gets the gateway notifications a real one would:
 * created, then captured or failed, sometimes refunded or disputed later.
 *
 * The story it tells, so every page has something to find:
 *   - Safari on the current release (web@1.2.0) fails far more often at the authorization step.
 *   - UPI fails more on mobile (collect requests expire); cards fail on OTP.
 *   - Razorpay had an outage yesterday during a flash sale: most payments in a 50 minute window failed with a gateway error.
 * Everything it writes has a gateway_event_id starting "demo_" and an order id starting "order_demo_", so --remove is exact.
 */
import { env } from "@trackme/config";
import { db, eq, sites } from "@trackme/db";
import { getClickHouseClient } from "@trackme/analytics";

const args = process.argv.slice(2);
const SITE_KEY = args.find((a) => a.startsWith("--site-key="))?.split("=")[1] ?? "site_pub_JI7qJQ5_E0WXH5SRwqJFLx59";
const REMOVE = args.includes("--remove");
const RESEED = args.includes("--reseed");
const DB = "growth_analytics";
const DAY = 86_400_000;
const NOW = Date.now();
const DEPLOY_CUR = NOW - 2.5 * DAY;
const ch = getClickHouseClient();
void env;

let seed = 0x5eed1234;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const between = (a: number, b: number) => a + rand() * (b - a);
const id = (n: number) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rand() * 36)]).join("");
const iso = (ms: number) => new Date(ms).toISOString();

// Yesterday 14:00 UTC for 50 minutes.
const OUTAGE_START = new Date(NOW - DAY).setUTCHours(14, 0, 0, 0);
const OUTAGE_END = OUTAGE_START + 50 * 60_000;

interface Row {
  workspace_id: string; site_id: string; gateway: string; gateway_event_id: string; payment_id: string; order_id: string;
  status: string; amount_minor: number; currency: string; method: string; failure_code_raw: string; bank: string;
  customer_ref: string; session_ref: string; user_ref: string; created_at: string;
}

interface CheckoutSession { session_hash: string; at: string; browser: string; device: string; country: string; user: string }

const BANKS = ["HDFC", "ICICI", "SBI", "Axis", "Kotak", "Yes Bank"];
const UPI_PSPS = ["okhdfcbank", "oksbi", "ybl", "paytm", "okaxis"];

function failure(method: string, ctx: { safari: boolean; outage: boolean; mobile: boolean }): string {
  if (ctx.outage) return "gateway:payment_processing:gateway_timeout:GATEWAY_ERROR";
  if (method === "card") {
    return pick(ctx.safari
      ? ["customer:payment_authentication:3ds_challenge_failed:BAD_REQUEST_ERROR", "customer:payment_authentication:3ds_challenge_failed:BAD_REQUEST_ERROR", "bank:payment_authorization:card_declined:BAD_REQUEST_ERROR"]
      : ["customer:payment_authentication:otp_incorrect:BAD_REQUEST_ERROR", "bank:payment_authorization:insufficient_funds:BAD_REQUEST_ERROR", "bank:payment_authorization:card_declined:BAD_REQUEST_ERROR", "customer:payment_authentication:otp_expired:BAD_REQUEST_ERROR"]);
  }
  if (method === "upi") {
    return pick(ctx.mobile
      ? ["customer:collect_request:expired:BAD_REQUEST_ERROR", "customer:collect_request:expired:BAD_REQUEST_ERROR", "bank:payment_authorization:upi_limit_exceeded:BAD_REQUEST_ERROR", "customer:payment_authentication:wrong_pin:BAD_REQUEST_ERROR"]
      : ["customer:collect_request:expired:BAD_REQUEST_ERROR", "bank:payment_authorization:insufficient_funds:BAD_REQUEST_ERROR"]);
  }
  return pick(["bank:payment_authorization:bank_declined:BAD_REQUEST_ERROR", "customer:payment_authentication:abandoned:BAD_REQUEST_ERROR"]);
}

async function remove(siteId: string): Promise<void> {
  const opts = { clickhouse_settings: { mutations_sync: 2, allow_nondeterministic_mutations: 1 } };
  await ch.command({ query: `DELETE FROM ${DB}.payment_events WHERE site_id = '${siteId}' AND startsWith(gateway_event_id, 'demo_')`, ...opts });
  await ch.command({ query: `DELETE FROM ${DB}.order_session WHERE site_id = '${siteId}' AND startsWith(order_id, 'order_demo_')`, ...opts });
  console.log("Demo payments removed.");
}

async function main(): Promise<void> {
  const [site] = await db.select({ id: sites.id, workspaceId: sites.workspaceId, domain: sites.domain }).from(sites).where(eq(sites.publicKey, SITE_KEY)).limit(1);
  if (!site) throw new Error(`No site with the public key ${SITE_KEY}`);
  if (REMOVE) return remove(site.id);

  const existing = (await (await ch.query({ query: `SELECT count() AS n FROM ${DB}.payment_events WHERE site_id = '${site.id}' AND startsWith(gateway_event_id, 'demo_')`, format: "JSONEachRow" })).json()) as Array<{ n: string }>;
  if (Number(existing[0]?.n ?? 0) > 0) {
    if (!RESEED) throw new Error(`Demo payments are already there (${existing[0]!.n} rows). Use --reseed or --remove.`);
    await remove(site.id);
  }

  const sessions = (await (
    await ch.query({
      query: `SELECT toString(session_hash) AS session_hash, toString(min(timestamp)) AS at, any(browser) AS browser, any(device) AS device,
                     any(country) AS country, anyIf(JSONExtractString(properties_json, 'distinctId'), JSONExtractString(properties_json, 'distinctId') != '') AS user
              FROM ${DB}.events_v2
              WHERE site_id = {site:UUID} AND JSONExtractBool(properties_json, 'demo') AND type = 'pageview' AND path = '/checkout'
              GROUP BY session_hash`,
      query_params: { site: site.id },
      format: "JSONEachRow",
    })
  ).json()) as CheckoutSession[];
  if (sessions.length === 0) throw new Error("No demo checkout sessions found. Run seed-suite-demo.mts first.");

  const rows: Row[] = [];
  const orders: Array<{ workspace_id: string; site_id: string; order_id: string; session_hash: string; user_id: string; ts: string }> = [];
  let seq = 0;

  for (const s of sessions) {
    if (rand() > 0.72) continue; // viewed the checkout page but never pressed pay
    const start = Date.parse(s.at.replace(" ", "T") + "Z") + Math.round(between(20_000, 90_000));
    if (start > NOW - 60_000) continue;
    const intl = s.country !== "IN";
    const gateway = intl ? "stripe" : "razorpay";
    const currency = intl ? "USD" : "INR";
    const plan = pick(["pro", "pro", "team", "starter"]);
    const amount = (intl ? { starter: 900, pro: 2900, team: 9900 } : { starter: 49900, pro: 239900, team: 799900 })[plan as "pro"];
    const mobile = s.device === "mobile";
    const method = intl ? (rand() < 0.93 ? "card" : "wallet") : mobile ? (rand() < 0.62 ? "upi" : rand() < 0.7 ? "card" : "netbanking") : rand() < 0.6 ? "card" : rand() < 0.5 ? "upi" : "netbanking";
    const safari = s.browser === "Safari" && start >= DEPLOY_CUR;
    const outage = gateway === "razorpay" && start >= OUTAGE_START && start <= OUTAGE_END;

    let pFail = 0.07 + (method === "upi" && mobile ? 0.05 : 0) + (method === "card" ? 0.02 : 0);
    if (safari && method === "card") pFail = 0.62;
    if (outage) pFail = 0.86;
    const failed = rand() < pFail;

    const n = ++seq;
    const orderId = `order_demo_${String(n).padStart(5, "0")}`;
    const payId = `pay_demo_${id(10)}`;
    const base = {
      workspace_id: site.workspaceId, site_id: site.id, gateway, payment_id: payId, order_id: orderId, amount_minor: amount, currency, method,
      bank: method === "upi" ? pick(UPI_PSPS) : method === "netbanking" || method === "card" ? pick(BANKS) : "",
      customer_ref: s.user ? `cust_${s.user.slice(-8)}` : "", session_ref: s.session_hash, user_ref: s.user,
    };
    const ev = (suffix: string, status: string, at: number, failure_code_raw = "", amount_minor = amount): Row => ({
      ...base, gateway_event_id: `demo_${n}_${suffix}`, status, created_at: iso(at), failure_code_raw, amount_minor,
    });

    orders.push({ workspace_id: site.workspaceId, site_id: site.id, order_id: orderId, session_hash: s.session_hash, user_id: s.user, ts: iso(start) });
    rows.push(ev("created", "created", start + 2000));
    if (failed) {
      rows.push(ev("failed", "failed", start + Math.round(between(15_000, 70_000)), failure(method, { safari: safari && method === "card", outage, mobile })));
      continue;
    }
    const captured = start + Math.round(between(15_000, 50_000));
    if (method === "card") rows.push(ev("authorized", "authorized", captured - 5000));
    rows.push(ev("captured", "captured", captured));
    if (rand() < 0.045) {
      const at = captured + Math.round(between(1, 6) * DAY);
      if (at < NOW) rows.push(ev("refund", "refunded", at, "", rand() < 0.7 ? amount : Math.round(amount / 2)));
    } else if (rand() < 0.004) {
      const at = captured + Math.round(between(4, 15) * DAY);
      if (at < NOW) rows.push(ev("dispute", "disputed", at, "", amount));
    }
  }

  // A flash sale yesterday: busy enough that the outage inside it is unmistakable. These orders come from the gateway only
  // (no browser session was recorded for them), which is also what a mobile-app or server-created order looks like.
  const SALE_START = new Date(NOW - DAY).setUTCHours(13, 30, 0, 0);
  for (let k = 0; k < 160; k += 1) {
    const start = SALE_START + Math.round((k / 160) * 120 * 60_000 + between(0, 20_000));
    const n = ++seq;
    const method = rand() < 0.55 ? "upi" : rand() < 0.7 ? "card" : "netbanking";
    const outage = start >= OUTAGE_START && start <= OUTAGE_END;
    const amount = pick([49900, 239900, 239900, 799900]);
    const base = {
      workspace_id: site.workspaceId, site_id: site.id, gateway: "razorpay", payment_id: `pay_demo_${id(10)}`, order_id: `order_demo_${String(n).padStart(5, "0")}`,
      amount_minor: amount, currency: "INR", method, bank: method === "upi" ? pick(UPI_PSPS) : pick(BANKS), customer_ref: "", session_ref: "", user_ref: "",
    };
    const ev = (suffix: string, status: string, at: number, code = ""): Row => ({ ...base, gateway_event_id: `demo_${n}_${suffix}`, status, created_at: iso(at), failure_code_raw: code });
    rows.push(ev("created", "created", start));
    if (rand() < (outage ? 0.86 : 0.07)) rows.push(ev("failed", "failed", start + 30_000, failure(method, { safari: false, outage, mobile: method === "upi" })));
    else rows.push(ev("captured", "captured", start + 30_000));
  }

  for (let i = 0; i < rows.length; i += 2000) {
    await ch.insert({ table: `${DB}.payment_events`, format: "JSONEachRow", values: rows.slice(i, i + 2000), clickhouse_settings: { date_time_input_format: "best_effort" } });
  }
  await ch.insert({ table: `${DB}.order_session`, format: "JSONEachRow", values: orders, clickhouse_settings: { date_time_input_format: "best_effort" } });

  const captured = rows.filter((r) => r.status === "captured").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  console.log(`Seeded ${orders.length} orders: ${captured} captured, ${failed} failed, ${rows.filter((r) => r.status === "refunded").length} refunded, ${rows.filter((r) => r.status === "disputed").length} disputed.`);
  console.log("Remove with: node --import tsx seed-payments-demo.mts --remove");
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
