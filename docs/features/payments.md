# Payments & Revenue

Connects a payment gateway to a site and answers: how much came in, where checkout loses people, which gateway is unhealthy, why payments fail, which
errors cost money, whether failed customers come back, and what was refunded or disputed.

Gateways today: **Razorpay** and **Stripe**. Adding one is one adapter file in `packages/payments/src` and one line in its registry.

## How it fits together

```
gateway ── signed webhook ──▶ /api/v1/webhooks/payments/<gateway>/<site key>
                                 verify signature · drop duplicates · keep raw body (90 days) · normalise
                                          │
                                          ▼
                         ClickHouse payment_events  (one row per notification, integer minor units, 25 months)
                                          │
        browser trackPayment("initiated", { orderId }) ─▶ order_session (which session placed which order)
                                          │
   every minute ─ classifier ─▶ payment_failure_class   (why each failure happened, which rule decided)
   every hour   ─ rollup     ─▶ leak_sessions           (one row per checkout session: paid, amount, errors seen)
```

Pages (sidebar, Payments & Revenue): **Payments Overview**, **Checkout Funnel**, **Gateway Health**, **Failure Doctor**, **Recovery**, **Revenue Leaks**,
**Refunds & Disputes**, **Integrations**.

## Connect a gateway

1. Integrations page: copy the webhook URL for the gateway into its dashboard and subscribe to the events listed there.
2. Paste the gateway's webhook **signing secret**. It is stored encrypted (AES-256-GCM) and never shown again; rotate by pasting a new one.
3. Make a test payment. The status turns green when the first event arrives.

The endpoint answers 200 for a good or repeated event, 401 for a bad or stale signature, 404 for an unknown site or a gateway that is not connected (the same
answer for both, so keys cannot be probed), 400 for an oversized or malformed body, 429 when one address sends too many rejected requests, and 500 only when
storing failed, which makes the gateway retry.

Razorpay: events `payment.authorized`, `payment.captured`, `payment.failed`, `refund.processed`, `payment.dispute.created`. Signature over the raw body.
Stripe: `payment_intent.created`, `.amount_capturable_updated`, `.succeeded`, `.payment_failed`, `refund.created`, `charge.dispute.created`. Signature `t=…,v1=…`
over `t.body`, five-minute tolerance.

## Link payments to sessions

Without this, payments are counted but cannot be tied to a visit, a user or an error.

```js
// Server, when you create the gateway order (Stripe: metadata instead of notes)
const order = await gateway.orders.create({ amount, currency, notes: { trackme_user: user.id } });

// Browser, when the shopper starts paying
trackme.trackPayment("initiated", { orderId: order.id, amount, currency, method: "upi" });
```

`trackPayment(stage, props)` is a normal custom event named `payment_<stage>`. The order id in it is what links the gateway's webhook to the session
(`order_session`). `trackme_user` / `trackme_session` in the order metadata link a payment to an identified user.

## What is stored, and what never is

Amounts as **integers in the currency's minor unit** (paise, cents). Never floats. Never summed across currencies.
Stored: gateway, event id, payment id, order id, status, amount, currency, method, the gateway's failure code, the bank or PSP **name**, the gateway's customer id,
your user and session references, refund or dispute reason code, dispute respond-by time.
**Never stored**: card numbers, CVV, UPI ids (only the handle after the `@`), email addresses, phone numbers, free-text descriptions. The adapters drop them before a row exists.

| Data | Where | Kept |
| --- | --- | --- |
| Normalised events | `payment_events` | 25 months |
| Failure classifications | `payment_failure_class` | 25 months |
| Order to session links | `order_session` | 25 months |
| Checkout session rollup | `leak_sessions` | 13 months |
| Raw webhook bodies | object store `payments/<site>/<day>/…` | 90 days (daily job) |

Erasure of an identified user removes their rows from `payment_events`, `order_session` and `payment_failure_class`.

## Failure Doctor

Each failed payment is classified by rules into: insufficient funds, bank declined, authentication failed, UPI timed out, UPI request expired, gateway problem,
network error, your app errored, customer left, blocked for risk, or not explained yet.

Order: rules that match the **gateway's own code** first; then rules that read the **context** (an error in the same session in the two minutes before, the
gateway's success rate at the time below 50% with at least 8 payments behind it, an attempt that took over three minutes); else unknown. The id of the deciding
rule is stored with every classification, and the page shows it.

The rules are data (`DEFAULT_RULES` in `packages/payments/src/failure-doctor.ts`). To use your own table, validate it with `parseRules` (it refuses an unknown
category, a duplicate id, a rule with no code tokens and no signals) and pass it to the classifier. **Coverage**, the share not left as "unknown", is shown on the
page; below 80% it says so and asks for rules for the top raw codes listed.

## Recovery

A failed payment counts as recovered when the same **order**, or the same identified **customer**, has a captured payment afterwards, within 24 or 72 hours.
Payments with neither cannot be followed and count as not recovered. Each classified failure is also published on the Redis stream `payments:failed` (site, payment,
order, cause, amount, currency, method, customer reference) so your own mailer or WhatsApp sender can follow up; TrackMe sends no messages.

## Revenue Leaks

For each error group seen in a checkout session (a visit that opened the checkout page; errors from ten minutes before it opened count):

- **Up to**: sessions that saw it and did not pay, times the average order value. An upper bound.
- **Beyond normal drop-off**: the gap between conversion with and without the error, times the sessions that saw it, times the average order value. Zero when they convert alike.
- Published only with at least 20 sessions that saw it and 30 others to compare with; confidence from a two-proportion test. Everything is labelled an estimate.
- CSV export on the page. Checkout is the page at `/checkout` (set `CHECKOUT_PATH` for the worker to change it).

## Operations

| Job | When | What |
| --- | --- | --- |
| `payment_failure_classifier` | every minute | classifies new failures (a failure is picked up a minute after it happens) |
| `revenue_leak_rollup` | hourly at :20 | rebuilds today and yesterday of `leak_sessions` |
| `payment_payload_retention` | daily 04:00 UTC | deletes raw payloads older than 90 days |

Verify a deployment end to end (real handler, real stores, throwaway data that it removes):
`cd apps/web && node --import tsx scripts/e2e-payment-webhook.mts`

Demo data: `node --import tsx services/scheduled-worker/seed-payments-demo.mts [--reseed | --remove]` after the suite seeder. Adds orders, retries, refunds with reasons, disputes with
deadlines, and demo checkout sessions for Revenue Leaks (session hashes from 2^62 up so `--remove` finds exactly them).

Migrations (each with a rollback under `down/`): ClickHouse `019_payments`, `020_payment_failure_class`, `021_payment_reason_due`, `022_leak_sessions`; Postgres `0009_site_payment_gateways`.
The ClickHouse rollbacks were exercised; the Postgres one is a single `DROP TABLE IF EXISTS`.

## Limits, said plainly

- **MRR, expansion and churn, LTV are not shown.** They need subscription data (plans, renewals, cancellations). The webhooks here describe one-time payments, so any such figure
  would be invented. Revenue, average order value and revenue per paying customer are shown instead. (Per paying customer, not per visitor: anonymous visitors cannot be followed across days.)
- Success rate is per **payment**, so a customer who fails and then succeeds on a retry counts one failure and one success; Recovery shows the order-level outcome.
- The webhook's critical path is two remote calls (a duplicate check in Redis, then the ClickHouse insert, in parallel with saving the raw body). Its speed is the round-trip time to those services.
- Revenue Leaks covers **errors**. Slow pages are not yet joined in.
