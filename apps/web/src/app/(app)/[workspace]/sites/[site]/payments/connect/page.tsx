import { notFound } from "next/navigation";
import { env } from "@trackme/config";
import { db, eq, sitePaymentGateways } from "@trackme/db";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { PaymentGatewayCard, type GatewayState } from "@/components/payment-gateway-card";
import { CopyButton } from "@/components/ui/copy-button";

const GATEWAYS = [
  { gateway: "razorpay", label: "Razorpay", events: "payment.authorized, payment.captured, payment.failed, refund.processed, payment.dispute.created" },
  { gateway: "stripe", label: "Stripe", events: "payment_intent.created, payment_intent.succeeded, payment_intent.payment_failed, refund.created, charge.dispute.created" },
] as const;

const LINK_SNIPPET = `// Server side, when you create the gateway order (Stripe: metadata instead of notes):
const order = await gateway.orders.create({
  amount, currency,
  notes: { trackme_user: user.id },
});

// Browser, when the shopper starts paying:
trackme.trackPayment("initiated", { orderId: order.id, amount, currency, method: "upi" });`;

export default async function PaymentConnectPage({ params }: { params: Promise<{ workspace: string; site: string }> }) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  let site: Awaited<ReturnType<typeof requireDashboardSite>>["site"];
  try {
    ({ site } = await requireDashboardSite(user.id, workspaceSlug, siteDomain));
  } catch {
    notFound();
  }

  const rows = await db.select().from(sitePaymentGateways).where(eq(sitePaymentGateways.siteId, site.id));
  const base = env.APP_URL.replace(/\/$/, "");
  const cards: GatewayState[] = GATEWAYS.map((g) => {
    const row = rows.find((r) => r.gateway === g.gateway);
    return {
      ...g,
      connected: Boolean(row),
      enabled: row?.enabled ?? false,
      lastEventAt: row?.lastEventAt?.toISOString() ?? null,
      webhookUrl: `${base}/api/v1/webhooks/payments/${g.gateway}/${site.publicKey}`,
    };
  });

  return (
    <div className="space-y-8 max-w-4xl">
      <PageHeader title="Payment Integrations" art="gauge">
        Connect your payment gateway for <span className="font-mono text-zinc-300">{site.domain}</span>. TrackMe receives signed webhooks and stores
        amounts and failure codes only, never card numbers, UPI ids, emails or phone numbers.
      </PageHeader>
      {cards.map((g) => (
        <PaymentGatewayCard key={g.gateway} siteId={site.id} g={g} />
      ))}
      <section className="linear-card p-6 space-y-3">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <h3 className="text-sm font-medium text-zinc-50">Link payments to sessions</h3>
          <CopyButton text={LINK_SNIPPET} label="Copy" />
        </div>
        <p className="text-xs text-zinc-500">
          Reporting the order id from the browser lets TrackMe tie a payment to the session, the user and any errors that shopper hit.
        </p>
        <pre className="overflow-x-auto rounded bg-white/[0.04] p-3 font-mono text-xs text-zinc-300">{LINK_SNIPPET}</pre>
      </section>
    </div>
  );
}
