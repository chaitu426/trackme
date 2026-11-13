import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBillingSummary, priceFor } from "@trackme/billing";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceBySlug, getWorkspaceUsage } from "@/lib/tenancy";
import { canManageBilling, isDemoBilling } from "@/lib/billing";
import { planUsage } from "@/lib/plan";
import { planRows } from "@/lib/plan-copy";
import { BillingClient } from "./billing-client";

export const metadata: Metadata = { title: "Plan & billing" };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export default async function BillingPage(props: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { workspace: slug } = await props.params;
  const search = await props.searchParams;

  const workspace = await requireWorkspaceBySlug(user.id, slug).catch(() => null);
  if (!workspace) notFound();

  const [canManage, summary, usage, counts] = await Promise.all([
    canManageBilling(user.id, workspace.companyId),
    getBillingSummary(workspace.companyId),
    getWorkspaceUsage(workspace.id),
    planUsage(workspace.id, workspace.companyId),
  ]);

  const checkout = search.checkout === "success" || search.checkout === "cancelled" ? search.checkout : null;

  return (
    <BillingClient
      workspaceSlug={workspace.slug}
      companyId={workspace.companyId}
      canManage={canManage}
      demo={isDemoBilling()}
      // The clock controls exist only outside production, mirroring the route that serves them.
      devControls={isDemoBilling() && process.env.NODE_ENV !== "production"}
      checkout={checkout}
      plan={summary.plan}
      grandfathered={summary.grandfathered}
      trialAvailable={summary.trialAvailable}
      subscription={
        summary.subscription
          ? {
              status: summary.subscription.status,
              interval: summary.subscription.interval,
              trialEnd: iso(summary.subscription.trialEnd),
              currentPeriodEnd: iso(summary.subscription.currentPeriodEnd),
              cancelAtPeriodEnd: summary.subscription.cancelAtPeriodEnd,
              graceEndsAt: iso(summary.subscription.graceEndsAt),
              provider: summary.subscription.provider,
            }
          : null
      }
      // Invoices are for the people who manage billing.
      invoices={
        canManage
          ? summary.invoices.map((i) => ({ id: i.id, number: i.number, amountMinor: i.amountMinor, currency: i.currency, status: i.status, date: iso(i.paidAt ?? i.createdAt)! }))
          : []
      }
      prices={{ month: priceFor("month"), year: priceFor("year") }}
      events={{ used: usage.currentUsage, quota: usage.monthlyQuota }}
      counts={counts}
      rows={planRows()}
    />
  );
}
