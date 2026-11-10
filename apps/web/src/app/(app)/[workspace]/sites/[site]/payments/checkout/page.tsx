import { notFound } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { getCheckoutFunnel, type CheckoutFunnel, type FunnelCounts } from "@trackme/analytics";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TableCardSkeleton } from "@/components/ui/skeleton";
import { Empty } from "@/components/ui/empty";
import { Alert } from "@/components/ui/alert";
import { RankedBars } from "@/components/ui/ranked-bar";
import { RangeSwitcher } from "@/components/range-switcher";
import { FunnelFlow } from "@/components/funnel-flow";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { cached } from "@/lib/query-cache";
import { parseRangeKey, type RangeKey } from "@/lib/date-range";
import { paymentRanges, rate } from "@/lib/payments-view";
import { formatNumber, formatPercent } from "@/lib/format";

const TTL_SECONDS = 300;
/** A group with fewer checkout views than this is too small to compare. */
const MIN_VIEWS = 30;
/** A group this many points below the overall conversion is shown as a problem. */
const WEAK_GAP = 10;

export default async function CheckoutFunnelPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; site: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  const range = parseRangeKey((await searchParams).range);

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;

  return (
    <div className="w-full space-y-5 text-left">
      <PageHeader title="Checkout Funnel" art="steps" actions={<RangeSwitcher range={range} />}>
        Where shoppers drop between the checkout page and a captured payment on <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>
      <Suspense key={range} fallback={<TableCardSkeleton rows={5} cols={4} />}>
        <Body siteId={site.id} range={range} connectHref={`/${workspace.slug}/sites/${site.domain}/payments/connect`} />
      </Suspense>
    </div>
  );
}

async function Body({ siteId, range, connectHref }: { siteId: string; range: RangeKey; connectHref: string }) {
  const { current } = paymentRanges(range);
  let funnel: CheckoutFunnel;
  try {
    funnel = await cached(`q:v1:pay:fn:${siteId}:${current.from}:${current.to}`, TTL_SECONDS, () => getCheckoutFunnel(siteId, current));
  } catch {
    return <Empty title="The checkout funnel is temporarily unavailable">Nothing is lost. Reload in a moment.</Empty>;
  }
  if (funnel.viewed === 0) {
    return (
      <Empty icon={ShoppingCart} title="Nobody viewed the checkout page in this period">
        The funnel starts from pageviews of /checkout.
      </Empty>
    );
  }

  const steps = [
    { label: "Viewed checkout", n: funnel.viewed, hint: "Sessions that opened /checkout" },
    { label: "Started a payment", n: funnel.started, hint: "Reported an order from the browser" },
    { label: "Reached the gateway", n: funnel.reached, hint: "The gateway notified about the order" },
    { label: "Paid", n: funnel.paid, hint: "A captured payment" },
  ];
  const overall = rate(funnel.paid, funnel.viewed) ?? 0;
  // The step that lost the most shoppers, said once in words above the chart.
  const losses = steps.slice(1).map((s, i) => ({ from: steps[i]!, to: s, lost: steps[i]!.n - s.n }));
  const worst = losses.reduce((a, b) => (b.lost > a.lost ? b : a));

  return (
    <>
      {funnel.started === 0 && (
        <Alert tone="warning" title="No payment was reported from the browser">
          Add <code className="font-mono text-zinc-300">trackme.trackPayment(&quot;initiated&quot;, {"{ orderId }"})</code> where the shopper presses pay.
          The snippet is on the <Link className="underline" href={connectHref}>Integrations</Link> page.
        </Alert>
      )}

      <Card className="enter overflow-hidden px-0 pb-0">
        <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
          <CardTitle>Checkout to payment</CardTitle>
          <CardDescription>
            {formatPercent(overall)} of checkout sessions paid.
            {worst.lost > 0 && ` The biggest loss is between "${worst.from.label}" and "${worst.to.label}": ${formatNumber(worst.lost)} sessions.`}
          </CardDescription>
        </CardHeader>
        <div className="px-5 py-5">
          <FunnelFlow steps={steps} />
        </div>
      </Card>

      <div className="enter grid gap-4 lg:grid-cols-2" style={{ ["--i" as string]: 2 }}>
        <Split title="Conversion by browser" rows={funnel.byBrowser} overall={overall} />
        <Split title="Conversion by device" rows={funnel.byDevice} overall={overall} />
      </div>
    </>
  );
}

function Split({ title, rows, overall }: { title: string; rows: Array<{ key: string } & FunnelCounts>; overall: number }) {
  return (
    <Card className="overflow-hidden px-0 pb-0">
      <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
        <CardTitle>{title}</CardTitle>
        <CardDescription>Paid as a share of checkout views. Groups under {MIN_VIEWS} views are too small to compare.</CardDescription>
      </CardHeader>
      <RankedBars
        rows={rows.map((m) => {
          const conv = rate(m.paid, m.viewed);
          const small = m.viewed < MIN_VIEWS;
          return {
            key: m.key,
            label: m.key,
            share: (conv ?? 0) / 100,
            value: conv === null ? "–" : formatPercent(conv),
            meta: small ? `${formatNumber(m.viewed)} views, too few` : `${formatNumber(m.paid)} of ${formatNumber(m.viewed)}`,
            bad: !small && conv !== null && conv < overall - WEAK_GAP,
          };
        })}
      />
    </Card>
  );
}
