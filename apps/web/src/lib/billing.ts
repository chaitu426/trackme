import type { NextRequest } from "next/server";
import { AppError } from "@trackme/contracts";
import {
  assertDemoAllowed,
  createDemoGateway,
  deliverSigned,
  demoSecret,
  type BillingGateway,
} from "@trackme/billing";
import { db, companies, companyMembers, eq, and, inArray } from "@trackme/db";
import { requireApiUser } from "@/lib/auth";
import { invalidateIngestSiteCache } from "@/lib/ingest-cache";
import { appOrigin } from "@/lib/brand";

/** The configured provider. `demo` moves no money; real adapters are added here and nowhere else. */
export function billingProviderId(): string {
  return (process.env.BILLING_PROVIDER ?? "demo").toLowerCase();
}

export function webhookUrl(provider: string): string {
  return `${appOrigin()}/api/v1/webhooks/billing/${provider}`;
}

export function getGateway(): BillingGateway {
  const provider = billingProviderId();
  if (provider === "demo") {
    assertDemoAllowed();
    return createDemoGateway({
      secret: demoSecret(),
      appOrigin: appOrigin(),
      deliver: (body, signature) => deliverSigned(webhookUrl("demo"), body, signature),
    });
  }
  throw new AppError(501, "BILLING_PROVIDER_UNSUPPORTED", `The payment provider '${provider}' is not set up yet.`);
}

/** True while the demo gateway is the active provider, so the UI can say that no real money moves. */
export function isDemoBilling(): boolean {
  return billingProviderId() === "demo";
}

/**
 * Managing a company's plan and billing is for its owners and billing admins. A workspace admin, however senior,
 * cannot change what the company pays.
 */
export async function requireCompanyBilling(
  request: NextRequest,
  companyId: string
): Promise<{ userId: string; email: string | null }> {
  const user = await requireApiUser(request);
  const [row] = await db
    .select({ role: companyMembers.role })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, user.id), inArray(companyMembers.role, ["owner", "billing_admin"])))
    .limit(1);
  if (!row) {
    throw new AppError(403, "FORBIDDEN", "Only the company owner or a billing admin can manage billing.");
  }
  return { userId: user.id, email: user.email ?? null };
}

/** Whether a person may manage this company's plan and billing (owner or billing admin). */
export async function canManageBilling(userId: string, companyId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: companyMembers.role })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId), inArray(companyMembers.role, ["owner", "billing_admin"])))
    .limit(1);
  return !!row;
}

/** Drops the edge's cached copy of these sites so a plan change applies in seconds. Never fails the caller. */
export async function purgeEdgeCache(publicKeyHashes: string[]): Promise<void> {
  await Promise.allSettled(publicKeyHashes.map((hash) => invalidateIngestSiteCache(hash)));
}

/** Only same-site relative paths may be used as a return address. */
export function safeReturnPath(value: string | undefined, fallback: string): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : fallback;
}

/** The plan a company is on, as one cheap read, for chrome that only needs to know whether to show the Pro mark. */
export async function companyPlan(companyId: string): Promise<"free" | "pro"> {
  const [row] = await db.select({ plan: companies.plan }).from(companies).where(eq(companies.id, companyId)).limit(1);
  return row?.plan === "pro" ? "pro" : "free";
}
