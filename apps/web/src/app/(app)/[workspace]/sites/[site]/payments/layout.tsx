import { notFound } from "next/navigation";
import { limitsFor } from "@trackme/contracts";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceBySlug } from "@/lib/tenancy";
import { planOfWorkspace } from "@/lib/plan";
import { canManageBilling } from "@/lib/billing";
import { LockedFeature } from "@/components/plan/locked-feature";
import { gateSection } from "@/lib/feature-gate";

/**
 * Payments analytics is a Pro feature. One layout covers every page under /payments, so a page added there later is
 * covered too, and the same check also runs on the server rather than only hiding a menu link.
 */
export default async function PaymentsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string; site: string }>;
}) {
  const user = await requireUser();
  const { workspace: slug } = await params;
  const workspace = await requireWorkspaceBySlug(user.id, slug).catch(() => null);
  if (!workspace) notFound();

  const { plan } = await planOfWorkspace(workspace.id);
  if (!limitsFor(plan).paymentsAnalytics) {
    return (
      <LockedFeature title="Payments analytics is part of Pro" workspaceSlug={workspace.slug} art="gauge" canUpgrade={await canManageBilling(user.id, workspace.companyId)}>
        Connect Stripe, Razorpay or PayPal to see revenue, failed payments, refunds, and the money lost to checkout problems, next to the sessions that caused them.
      </LockedFeature>
    );
  }
  return (await gateSection(params, "payments")) ?? children;
}
