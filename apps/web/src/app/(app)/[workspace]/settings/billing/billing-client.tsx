"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, FlaskConical, Minus } from "lucide-react";
import { limitOf, type LimitedResource } from "@trackme/contracts";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { GlyphMeter } from "@/components/ui/glyph-meter";
import { ConfirmDialog } from "@/components/ui/dialog";
import { PillTabs } from "@/components/motion/primitives";
import { PlanBadge } from "@/components/plan/plan-badge";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { describeStatus, formatDate, formatPrice, yearlySavingPercent, type SubscriptionView } from "@/lib/billing-view";
import type { PlanRow } from "@/lib/plan-copy";

type Interval = "month" | "year";

interface Props {
  workspaceSlug: string;
  companyId: string;
  canManage: boolean;
  demo: boolean;
  devControls: boolean;
  checkout: "success" | "cancelled" | null;
  plan: "free" | "pro";
  grandfathered: boolean;
  trialAvailable: boolean;
  subscription: SubscriptionView | null;
  invoices: { id: string; number: string; amountMinor: number; currency: string; status: string; date: string }[];
  prices: Record<Interval, { amountMinor: number; currency: string }>;
  events: { used: number; quota: number };
  counts: Record<LimitedResource, number>;
  rows: PlanRow[];
}

const METERS: { resource: LimitedResource; label: string; unit?: string }[] = [
  { resource: "sites", label: "Websites" },
  { resource: "workspaces", label: "Workspaces" },
  { resource: "members", label: "Members" },
  { resource: "viewers", label: "Viewers" },
  { resource: "apiKeys", label: "API keys" },
  { resource: "goals", label: "Goals" },
  { resource: "funnels", label: "Funnels" },
  { resource: "segments", label: "Segments" },
  { resource: "alertRules", label: "Alert rules" },
  { resource: "alertChannels", label: "Alert channels" },
  { resource: "askRuns", label: "Ask questions this month" },
];

async function call(url: string, init: RequestInit): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, message: String(body.detail ?? body.message ?? "Something went wrong. Try again.") };
    return { ok: true, body };
  } catch {
    return { ok: false, message: "The request could not be sent. Check your connection and try again." };
  }
}

export function BillingClient(props: Props) {
  const { workspaceSlug, companyId, canManage, demo, devControls, plan, subscription, prices, events, counts, rows } = props;
  const router = useRouter();
  const [interval, setInterval] = React.useState<Interval>(subscription?.interval ?? "year");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const now = React.useMemo(() => new Date(), []);
  const status = describeStatus(plan, subscription, props.grandfathered, now);
  const saving = yearlySavingPercent(prices.month.amountMinor, prices.year.amountMinor);
  const base = `/api/v1/companies/${companyId}/billing`;

  React.useEffect(() => {
    if (props.checkout === "success") toast.success("You are on Pro", "The payment went through and your limits have been raised.");
    if (props.checkout === "cancelled") toast({ title: "Checkout cancelled", description: "Nothing was charged.", tone: "info" });
  }, [props.checkout]);

  async function run(key: string, fn: () => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; message: string }>, done?: string) {
    setBusy(key);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      toast.error("Billing", result.message);
      return false;
    }
    if (done) toast.success(done);
    router.refresh();
    return true;
  }

  const upgrade = async () => {
    setBusy("checkout");
    const result = await call(`${base}/checkout`, { method: "POST", body: JSON.stringify({ interval, workspace: workspaceSlug }) });
    if (!result.ok) {
      setBusy(null);
      toast.error("Could not start checkout", result.message);
      return;
    }
    window.location.href = String(result.body.url);
  };

  const subscribed = !!subscription && subscription.provider !== "internal" && subscription.status !== "canceled";

  return (
    <div className="w-full space-y-6">
      <PageHeader title="Plan & billing" art="gauge">
        What this company is on, what it has used, and what Pro adds. Limits are shared by every workspace in the company.
      </PageHeader>

      {demo && (
        <Alert tone="warning" title="Demo payments: no real money moves">
          The payment gateway is a demo. Checkout uses test cards such as <span className="font-mono text-zinc-300">4242 4242 4242 4242</span>, and nothing is charged.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ── The plan ─────────────────────────────────────────────────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Current plan</CardTitle>
            <CardDescription>{canManage ? "You can change this as a company owner." : "Only the company owner can change the plan."}</CardDescription>
          </CardHeader>

          <div className="space-y-4">
            <div>
              <PlanBadge plan={plan} />
              <p className="mt-3 text-lg font-medium leading-6 text-zinc-50">{status.headline}</p>
              {status.detail && <p className="mt-1 text-xs leading-5 text-zinc-400">{status.detail}</p>}
            </div>

            {status.tone === "danger" && (
              <Alert tone="danger" title="Update your payment method">
                Pro keeps running during the grace period. If the payment is not fixed by then, the workspace drops to Free; your data is kept.
              </Alert>
            )}

            {canManage && (
              <div className="flex flex-wrap gap-2 pt-1">
                {props.trialAvailable && (
                  <Button variant="secondary" size="sm" loading={busy === "trial"} onClick={() => run("trial", () => call(`${base}/trial`, { method: "POST" }), "Your 14-day Pro trial has started")}>
                    Start 14-day free trial
                  </Button>
                )}
                {subscribed && !subscription.cancelAtPeriodEnd && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      loading={busy === "interval"}
                      onClick={() =>
                        run(
                          "interval",
                          () => call(`${base}/subscription`, { method: "PATCH", body: JSON.stringify({ action: "interval", interval: subscription.interval === "year" ? "month" : "year" }) }),
                          `Switching to ${subscription.interval === "year" ? "monthly" : "yearly"} billing at the next renewal`
                        )
                      }
                    >
                      Switch to {subscription.interval === "year" ? "monthly" : "yearly"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(true)}>
                      Cancel subscription
                    </Button>
                  </>
                )}
                {subscribed && subscription.cancelAtPeriodEnd && (
                  <Button size="sm" loading={busy === "resume"} onClick={() => run("resume", () => call(`${base}/subscription`, { method: "PATCH", body: JSON.stringify({ action: "resume" }) }), "Subscription resumed")}>
                    Resume subscription
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* ── Usage ────────────────────────────────────────────────────────────────────────────── */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>Against the {plan === "pro" ? "Pro" : "Free"} plan. Events reset on the 1st of each month.</CardDescription>
          </CardHeader>
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <GlyphMeter className="sm:col-span-2" label="Events this month" value={events.used} limit={events.quota} />
            {METERS.map((m) => (
              <GlyphMeter key={m.resource} label={m.label} value={counts[m.resource]} limit={limitOf(plan, m.resource)} cells={20} />
            ))}
          </div>
        </Card>
      </div>

      {/* ── Compare and upgrade ───────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle>Free and Pro</CardTitle>
            <CardDescription>{subscribed ? "Your plan is highlighted." : "Pro raises every limit and adds teams, payments analytics and the audit log."}</CardDescription>
          </div>
          {!subscribed && (
            <PillTabs
              kind="radio"
              label="Billing interval"
              value={interval}
              onChange={setInterval}
              items={[
                { id: "month", label: "Monthly" },
                { id: "year", label: saving > 0 ? `Yearly · save ${saving}%` : "Yearly" },
              ]}
            />
          )}
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="text-xs text-zinc-500">
                <th scope="col" className="w-[44%] border-b border-border pb-3 font-normal">
                  <span className="sr-only">Feature</span>
                </th>
                {(["free", "pro"] as const).map((p) => (
                  <th key={p} scope="col" className={cn("border-b border-border pb-3 pr-4 align-bottom font-normal", plan === p && "text-zinc-100")}>
                    <PlanBadge plan={p} />
                    <span className="mt-2 block font-mono text-sm text-zinc-200">
                      {p === "free" ? "$0" : `${formatPrice(prices[interval].amountMinor, prices[interval].currency)} / ${interval === "year" ? "year" : "month"}`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="group">
                  <th scope="row" className="border-b border-white/[0.05] py-2.5 pr-4 text-xs font-normal text-zinc-400">
                    {row.label}
                  </th>
                  {(["free", "pro"] as const).map((p) => {
                    const text = row[p];
                    const off = text === "Not included" || text === "Email only" || text === "CSV only";
                    return (
                      <td key={p} className={cn("border-b border-white/[0.05] py-2.5 pr-4 text-xs", off ? "text-zinc-500" : "text-zinc-200", plan === p && "bg-white/[0.02]")}>
                        <span className="inline-flex items-center gap-1.5">
                          {text === "Included" ? <Check className="size-3.5 text-good" aria-hidden="true" /> : text === "Not included" ? <Minus className="size-3.5" aria-hidden="true" /> : null}
                          {text === "Included" || text === "Not included" ? <span className="sr-only">{text}</span> : text}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canManage && !subscribed && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
            <p className="text-xs text-zinc-400">
              {formatPrice(prices[interval].amountMinor, prices[interval].currency)} {interval === "year" ? "a year, billed once" : "a month"}. Cancel any time; your data stays.
            </p>
            <Button loading={busy === "checkout"} onClick={upgrade}>
              {plan === "pro" ? "Subscribe to keep Pro" : "Upgrade to Pro"}
            </Button>
          </div>
        )}
      </Card>

      {/* ── Invoices ──────────────────────────────────────────────────────────────────────────── */}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>The last twelve.</CardDescription>
          </CardHeader>
          {props.invoices.length === 0 ? (
            <p className="font-mono text-xs text-zinc-500">No invoices yet.</p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {props.invoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-4 py-2.5 text-xs">
                  <span className="font-mono text-zinc-300">{inv.number}</span>
                  <span className="text-zinc-500">{formatDate(inv.date)}</span>
                  <span className="font-mono tabular-nums text-zinc-200">{formatPrice(inv.amountMinor, inv.currency)}</span>
                  <Badge variant={inv.status === "paid" ? "success" : inv.status === "failed" ? "warning" : "outline"}>{inv.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ── Demo clock (development and staging only) ─────────────────────────────────────────── */}
      {devControls && canManage && (
        <Card>
          <CardHeader>
            <CardTitle>
              <FlaskConical className="size-4 text-zinc-400" aria-hidden="true" />
              Demo clock
            </CardTitle>
            <CardDescription>Act as the payment provider to see what happens next. Not available in production.</CardDescription>
          </CardHeader>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["renew_ok", "Renewal succeeds", "Renewal paid"],
                ["renew_fail", "Renewal fails", "Renewal failed: grace period started"],
                ["expire_grace", "Grace period ends", "Grace period ended"],
                ["expire_trial", "Trial ends", "Trial ended"],
                ["end_period", "Paid period ends", "Paid period ended"],
              ] as const
            ).map(([action, label, done]) => (
              <Button key={action} variant="outline" size="sm" disabled={!subscription} loading={busy === action} onClick={() => run(action, () => call(`${base}/demo-clock`, { method: "POST", body: JSON.stringify({ action }) }), done)}>
                {label}
              </Button>
            ))}
          </div>
          {!subscription && <p className="mt-3 text-xs text-zinc-500">Start a trial or subscribe first.</p>}
        </Card>
      )}

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel your Pro subscription?"
        description={`Pro stays on until ${formatDate(subscription?.currentPeriodEnd ?? null)}. After that the workspace returns to Free: your data is kept, but limits drop and Pro-only pages lock.`}
        confirmLabel="Cancel at period end"
        loading={busy === "cancel"}
        onConfirm={async () => {
          const ok = await run("cancel", () => call(`${base}/subscription`, { method: "PATCH", body: JSON.stringify({ action: "cancel" }) }), "Subscription will end at the close of the period");
          if (ok) setConfirmCancel(false);
        }}
      />
    </div>
  );
}
