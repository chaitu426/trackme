import type { Answer, AskScope, EvidenceItem, SourceId } from "./types";

/**
 * A stand-in for the agent while the interface is built, so Ask can be used and judged end to end. It matches a question to one of
 * a few prepared answers, drawn from the demo dataset, each with real-looking steps, queries and evidence. A question it cannot
 * match gets an honest "I cannot answer that from the connected sources" with what it could answer, never an invented number.
 *
 * The backend phase replaces `answerFor` with a planner and a query runner; nothing in the interface depends on how an `Answer` is made.
 */

const ev = (e: Omit<EvidenceItem, "language">): EvidenceItem => ({ language: "sql", ...e });

interface Script {
  id: string;
  /** Words that make this answer relevant; the most matches wins. */
  keywords: string[];
  /** The sources it reads, so a source the person switched off blocks it with a clear message. */
  needs: SourceId[];
  build(base: string): Answer;
}

const FAIL_QUERY = `SELECT category, count() AS failures, sum(amount_minor) / 100 AS value
FROM growth_analytics.payment_failure_class FINAL
WHERE site_id = {siteId} AND toDate(failed_at) BETWEEN {from} AND {to}
GROUP BY category ORDER BY value DESC`;

const SCRIPTS: Script[] = [
  {
    id: "success-drop",
    keywords: ["success", "rate", "drop", "dropped", "payment", "payments", "fail", "failing", "failed", "gateway", "outage", "razorpay", "yesterday"],
    needs: ["payments"],
    build: (base) => ({
      steps: [
        { id: "s1", label: "Reading gateway health for the last 7 days", detail: "payment_events, 5-minute buckets", ms: 620 },
        { id: "s2", label: "Looking for stretches far below the gateway's normal", detail: "Binomial test against its own failure rate", ms: 540 },
        { id: "s3", label: "Reading what those failures were classified as", detail: "payment_failure_class", ms: 480 },
        { id: "s4", label: "Checking whether the other gateway was affected", ms: 360 },
      ],
      blocks: [
        { type: "text", text: "Razorpay had an incident yesterday from 14:00 to 14:40 UTC. In those forty minutes every one of 26 payments failed, all with the same gateway timeout code [1]. Over the rest of the week its success rate was about 95%." },
        { type: "stats", items: [{ label: "Razorpay in the incident", value: "0 of 26", tone: "down", cite: 1 }, { label: "Razorpay normally", value: "95%", cite: 1 }, { label: "Stripe the same hour", value: "No change", cite: 3 }] },
        { type: "bars", title: "What the week's failures were", rows: [{ label: "Gateway problem", display: "₹176,940 · 60", value: 60, cite: 2 }, { label: "Bank declined", display: "₹17,595 · 5", value: 5, cite: 2 }, { label: "UPI request expired", display: "₹15,695 · 5", value: 5, cite: 2 }, { label: "Insufficient funds", display: "₹12,797 · 3", value: 3, cite: 2 }] },
        { type: "callout", tone: "info", text: "Stripe payments in the same window were unaffected, so this was Razorpay, not your checkout or your network." },
      ],
      evidence: [
        ev({ n: 1, title: "Razorpay success by 5 minutes, last 7 days", source: "payments", table: "payment_events", query: `SELECT toStartOfFiveMinute(done_at) AS bucket, sum(was_paid) AS paid, count() AS outcomes\nFROM (\n  SELECT payment_id, max(status = 'captured') AS was_paid,\n         maxIf(created_at, status IN ('captured','failed')) AS done_at\n  FROM growth_analytics.payment_events FINAL\n  WHERE site_id = {siteId} AND gateway = 'razorpay' AND created_at >= now() - INTERVAL 7 DAY\n  GROUP BY payment_id\n)\nGROUP BY bucket ORDER BY bucket`, range: "Last 7 days", rows: 2016, ms: 184, columns: ["bucket (UTC)", "paid", "outcomes"], sample: [["Nov 8 13:55", 7, 8], ["Nov 8 14:00", 0, 6], ["Nov 8 14:05", 0, 7], ["Nov 8 14:10", 1, 7]], openHref: `${base}/payments/health`, note: "Incidents are stretches whose failures are too many to be chance given the gateway's own failure rate (p < 0.001)." }),
        ev({ n: 2, title: "Failures by classified cause", source: "payments", table: "payment_failure_class", query: FAIL_QUERY, range: "Last 7 days", rows: 9, ms: 61, columns: ["category", "failures", "value (₹)"], sample: [["gateway_outage", 60, 176940], ["bank_decline", 5, 17595], ["upi_pending_expired", 5, 15695]], openHref: `${base}/payments/failures` }),
        ev({ n: 3, title: "Stripe success by 5 minutes, same window", source: "payments", table: "payment_events", query: `SELECT toStartOfFiveMinute(done_at) AS bucket, sum(was_paid) AS paid, count() AS outcomes\nFROM ( … same per-payment outcome as above … )\nWHERE gateway = 'stripe' AND bucket BETWEEN '2026-11-08 14:00' AND '2026-11-08 14:40'`, range: "Nov 8, 14:00–14:40 UTC", rows: 8, ms: 47, columns: ["bucket (UTC)", "paid", "outcomes"], sample: [["Nov 8 14:00", 2, 2], ["Nov 8 14:10", 1, 1], ["Nov 8 14:30", 1, 1]], openHref: `${base}/payments/health` }),
      ],
      assumptions: ["A payment is judged by its final outcome, so a failed payment that later succeeded under the same payment id counts as a success.", "Times are UTC."],
      confidence: "high",
      followups: ["How much revenue did that incident cost?", "Did those customers come back and pay?", "Which payment method failed most that day?"],
      ideas: [{ title: "Get told next time", detail: "Alert when a gateway's success rate falls below 70% over 15 minutes (alerts arrive in the next release)." }, { title: "Add a fallback gateway", detail: "60 failures here were the gateway's own. A second gateway would have taken some of that." }],
    }),
  },
  {
    id: "leak",
    keywords: ["error", "errors", "bug", "cost", "costs", "costing", "lose", "losing", "lost", "revenue", "money", "checkout", "fix", "first", "leak", "leaks"],
    needs: ["errors", "payments"],
    build: (base) => ({
      steps: [
        { id: "s1", label: "Finding the sessions that opened your checkout page", detail: "leak_sessions, 30 days", ms: 520 },
        { id: "s2", label: "Matching them to the errors they saw", ms: 460 },
        { id: "s3", label: "Comparing conversion with and without each error", detail: "Two-proportion test", ms: 610 },
        { id: "s4", label: "Valuing the difference at your average order", ms: 300 },
      ],
      blocks: [
        { type: "text", text: "Fix the TypeError on the checkout page first. 113 checkout sessions hit it and 23% of them paid, against 69% of sessions that did not [1]. Beyond normal drop-off that is roughly ₹195,970 over 30 days, and at most ₹330,296 if every one of those sessions would have paid [1]." },
        { type: "table", title: "Errors in checkout sessions, by estimated cost", columns: ["Error", "Sessions", "Paid with / without", "Beyond normal drop-off"], rows: [["TypeError: cannot read properties of undefined", "113", "23% / 69%", "₹195,970"], ["ReferenceError: analytics is not defined", "54", "61% / 60%", "None found"], ["HttpError: GET /api/cart 500", "28", "61% / 60%", "None found"]], cite: 1 },
        { type: "callout", tone: "warn", text: "The other two errors are noisier but their sessions paid as often as everyone else's, so nothing is attributed to them." },
      ],
      evidence: [
        ev({ n: 1, title: "Conversion with and without each error", source: "payments", table: "leak_sessions", query: `SELECT toString(g) AS group_id, count() AS sessions, countIf(paid = 1) AS paid\nFROM growth_analytics.leak_sessions FINAL\nARRAY JOIN error_groups AS g\nWHERE site_id = {siteId} AND day BETWEEN {from} AND {to}\nGROUP BY g ORDER BY sessions DESC`, range: "Last 30 days", rows: 4, ms: 92, columns: ["group_id", "sessions", "paid"], sample: [["18288…7060", 113, 26], ["15528…9371", 54, 33], ["31962…3434", 28, 17]], openHref: `${base}/payments/leaks`, note: "Control: the other 511 sessions paid 69%. Confidence is high: 113 sessions and a gap that is very unlikely to be chance (p < 0.001)." }),
      ],
      assumptions: ["A session counts as affected if the error happened from ten minutes before the checkout page opened.", "Average order value is used to value a lost sale, so the money is an estimate."],
      confidence: "high",
      followups: ["Which browsers see the TypeError?", "Which release introduced it?", "Show me an example stack trace"],
      ideas: [{ title: "Open the issue", detail: "See the source-mapped stack, the release it started in, and the affected users." }, { title: "Track the fix", detail: "After you deploy, Release Impact will compare conversion before and after." }],
    }),
  },
  {
    id: "funnel",
    keywords: ["drop", "drops", "off", "funnel", "checkout", "abandon", "convert", "conversion", "browser", "safari", "chrome", "where"],
    needs: ["traffic", "payments"],
    build: (base) => ({
      steps: [
        { id: "s1", label: "Counting sessions that viewed checkout", detail: "events_v2, pageviews of /checkout", ms: 500 },
        { id: "s2", label: "Following them to a started payment and a captured one", ms: 560 },
        { id: "s3", label: "Splitting by browser", ms: 320 },
      ],
      blocks: [
        { type: "text", text: "Of 442 sessions that viewed checkout, 304 started a payment and 273 paid, so 61.8% converted [1]. The biggest loss, 138 sessions, is before anyone starts paying. Safari converts worst at 56.5% against Chrome's 64.5% [2]." },
        { type: "bars", title: "Checkout, in sessions", rows: [{ label: "Viewed checkout", display: "442", value: 442, cite: 1 }, { label: "Started a payment", display: "304 · 68.8%", value: 304, cite: 1 }, { label: "Paid", display: "273 · 61.8%", value: 273, cite: 1 }] },
        { type: "bars", title: "Conversion by browser", rows: [{ label: "Chrome", display: "64.5%", value: 64.5, cite: 2 }, { label: "Edge", display: "56.4%", value: 56.4, cite: 2 }, { label: "Safari", display: "56.5%", value: 56.5, cite: 2 }, { label: "Firefox", display: "62.2%", value: 62.2, cite: 2 }] },
      ],
      evidence: [
        ev({ n: 1, title: "Checkout funnel, sessions", source: "payments", table: "events_v2 ⨝ order_session ⨝ payment_events", query: `WITH viewers AS (\n  SELECT session_hash FROM growth_analytics.events_v2\n  WHERE site_id = {siteId} AND type = 'pageview' AND path = '/checkout'\n    AND toDate(timestamp) BETWEEN {from} AND {to} GROUP BY session_hash\n)\nSELECT count() AS viewed, sum(started) AS started, sum(paid) AS paid FROM ( … per session … )`, range: "Last 30 days", rows: 1, ms: 233, columns: ["viewed", "started", "paid"], sample: [[442, 304, 273]], openHref: `${base}/payments/checkout` }),
        ev({ n: 2, title: "Conversion by browser", source: "traffic", table: "events_v2", query: `SELECT browser, count() AS viewed, sum(paid) AS paid\nFROM ( … same per-session rows … )\nGROUP BY browser ORDER BY viewed DESC`, range: "Last 30 days", rows: 5, ms: 244, columns: ["browser", "viewed", "paid"], sample: [["Chrome", 262, 169], ["Safari", 85, 48], ["Firefox", 45, 28], ["Edge", 39, 22]], openHref: `${base}/payments/checkout` }),
      ],
      assumptions: ["Orders are linked to sessions by trackPayment calls in the browser; a payment made without one is not followed.", "Groups under 30 sessions are too small to compare."],
      confidence: "medium",
      followups: ["Why do people not start paying?", "Is Safari worse since the last release?", "What happens on mobile?"],
      ideas: [{ title: "Segment Safari", detail: "Save Safari checkout visitors as a segment and watch them over time." }],
    }),
  },
  {
    id: "release",
    keywords: ["release", "deploy", "deployed", "version", "1.2.0", "1.1.0", "regress", "regressed", "rollback", "new", "ship", "shipped"],
    needs: ["releases", "errors"],
    build: (base) => ({
      steps: [
        { id: "s1", label: "Finding the release and the one before it", detail: "site_releases", ms: 300 },
        { id: "s2", label: "Comparing errors, conversion and load time", detail: "bounded to the first 72 hours", ms: 720 },
        { id: "s3", label: "Testing whether the differences could be chance", ms: 410 },
      ],
      blocks: [
        { type: "text", text: "web@1.2.0 looks regressed. The share of sessions with an error is 535% higher than before the deploy, driven by Safari, where it rose from 1.1% to 32% [1]. A rollback is suggested." },
        { type: "stats", items: [{ label: "Sessions with an error", value: "+535%", tone: "down", cite: 1 }, { label: "Safari error rate", value: "1.1% → 32%", tone: "down", cite: 1 }, { label: "Verdict", value: "Regressed", tone: "down", cite: 1 }] },
      ],
      evidence: [
        ev({ n: 1, title: "web@1.2.0 against the week before", source: "releases", table: "events_v2 (type = error) by release", query: `SELECT release, countIf(has_error) / count() AS error_rate, count() AS sessions\nFROM ( SELECT session_hash, any(release) AS release, max(type = 'error') AS has_error\n       FROM growth_analytics.events_v2 WHERE site_id = {siteId} AND timestamp BETWEEN {deploy} - INTERVAL 72 HOUR AND {deploy} + INTERVAL 72 HOUR\n       GROUP BY session_hash ) GROUP BY release`, range: "72 hours either side of the deploy", rows: 2, ms: 310, columns: ["release", "error rate", "sessions"], sample: [["web@1.1.0", "1.8%", 3120], ["web@1.2.0", "11.4%", 1604]], openHref: `${base}/releases`, note: "A verdict needs 500 sessions per side; this has 1,604 and 3,120." }),
      ],
      assumptions: ["Release is read from the tag the site sends with each event."],
      confidence: "high",
      followups: ["Which error is behind it?", "What would reverting cost us?", "Did conversion change?"],
      ideas: [{ title: "Compare the next deploy automatically", detail: "Release reports are built when a deploy is recorded." }],
    }),
  },
  {
    id: "traffic",
    keywords: ["traffic", "visitors", "sessions", "pageviews", "bounce", "pages", "popular", "sources", "referrer", "countries", "overview", "30", "days"],
    needs: ["traffic"],
    build: (base) => ({
      steps: [
        { id: "s1", label: "Reading daily traffic rollups", detail: "daily_pageviews_agg, session aggregates", ms: 380 },
        { id: "s2", label: "Comparing with the previous 30 days", ms: 330 },
      ],
      blocks: [
        { type: "text", text: "There were 13,238 sessions in the last 30 days, up from 11,420 in the 30 days before [1]. Bounce rate was 38.7%. Visitors are counted per day, since an anonymous visitor's ID changes every 24 hours." },
        { type: "stats", items: [{ label: "Sessions", value: "13,238", delta: "+15.9%", tone: "up", cite: 1 }, { label: "Bounce rate", value: "38.7%", cite: 1 }, { label: "Pageviews", value: "41,206", delta: "+12.1%", tone: "up", cite: 1 }] },
        { type: "spark", title: "Sessions per day", points: [310, 340, 365, 380, 420, 405, 390, 430, 460, 455, 470, 520, 510, 540, 530], display: "540 yesterday", cite: 1 },
      ],
      evidence: [
        ev({ n: 1, title: "Sessions, pageviews and bounce, 30 days", source: "traffic", table: "daily_pageviews_agg · session aggregates", query: `SELECT toString(day) AS day, sum(sessions) AS sessions, sum(pageviews) AS pageviews\nFROM growth_analytics.daily_pageviews_agg\nWHERE site_id = {siteId} AND day BETWEEN {from} AND {to}\nGROUP BY day ORDER BY day`, range: "Last 30 days", rows: 30, ms: 38, columns: ["day", "sessions", "pageviews"], sample: [["Nov 7", 530, 1612], ["Nov 8", 540, 1688], ["Nov 9", 498, 1531]], openHref: `${base.replace(/\/sites\/.*/, "")}/overview` }),
      ],
      assumptions: ["Visitors are not followed across days; only identified users are."],
      confidence: "high",
      followups: ["Where does the traffic come from?", "Which pages are most popular?", "How does mobile compare?"],
      ideas: [{ title: "Add a goal", detail: "Count signups or purchases as a goal and see which sources deliver them." }],
    }),
  },
];

export function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9.\s]/g, " ").split(/\s+/).filter((t) => t.length > 1);
}

/** Which prepared answer fits a question best, or null when none does (fewer than two matching words). */
export function matchScript(question: string): Script | null {
  const words = new Set(tokens(question));
  let best: { s: Script; score: number } | null = null;
  for (const s of SCRIPTS) {
    const score = s.keywords.reduce((n, k) => n + (words.has(k) ? 1 : 0), 0);
    if (score >= 2 && (!best || score > best.score)) best = { s, score };
  }
  return best?.s ?? null;
}

function declined(scope: AskScope): Answer {
  const on = Object.entries(scope.sources).filter(([, v]) => v).map(([k]) => k);
  return {
    steps: [{ id: "s1", label: "Checking what I can answer from the connected sources", ms: 360 }],
    blocks: [{ type: "text", text: "I can not answer that from the data I am allowed to read, and I will not guess at a number." }],
    evidence: [],
    assumptions: [],
    confidence: "low",
    followups: ["Why did the payment success rate drop?", "Which error costs us the most at checkout?", "Where do visitors drop off in checkout?"],
    ideas: [],
    limit: `Sources on right now: ${on.join(", ") || "none"}. Ask about traffic, errors, releases or payments in those sources, or open Configure to widen what I can read.`,
  };
}

/** A script whose sources are not all switched on is declined, naming the ones to switch on. */
export function answerFor(question: string, scope: AskScope, siteBase: string): Answer {
  const script = matchScript(question);
  if (!script) return declined(scope);
  const off = script.needs.filter((s) => !scope.sources[s]);
  if (off.length > 0) {
    const a = declined(scope);
    return { ...a, blocks: [{ type: "text", text: `That needs ${off.join(" and ")} data, which is switched off for me right now.` }], limit: `Switch on ${off.join(" and ")} under Configure and ask again.` };
  }
  return script.build(siteBase);
}

/** Every citation in an answer's text and blocks refers to an evidence item that exists. Used by tests and by the interface. */
export function citationsOf(answer: Answer): number[] {
  const found: number[] = [];
  for (const b of answer.blocks) {
    if (b.type === "text") for (const m of b.text.matchAll(/\[(\d+)\]/g)) found.push(Number(m[1]));
    if (b.type === "stats") for (const i of b.items) if (i.cite) found.push(i.cite);
    if (b.type === "bars") for (const r of b.rows) if (r.cite) found.push(r.cite);
    if ((b.type === "table" || b.type === "spark") && b.cite) found.push(b.cite);
  }
  return found;
}
