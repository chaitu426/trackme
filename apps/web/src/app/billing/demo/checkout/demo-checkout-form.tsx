"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button, buttonBase, buttonSizes, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { DrawCheck } from "@/components/motion/primitives";
import { cn } from "@/lib/utils";

type Step = "card" | "authenticate" | "done";

/** Groups digits in fours as the person types, the way a card field does. */
export function formatCardNumber(value: string): string {
  return value
    .replace(/\D/g, "")
    .slice(0, 19)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

export function DemoCheckoutForm({ session, cancelUrl, cards, amount }: { session: string; cancelUrl: string; cards: { number: string; label: string }[]; amount: string }) {
  const [card, setCard] = React.useState("");
  const [step, setStep] = React.useState<Step>("card");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [redirect, setRedirect] = React.useState<string | null>(null);

  async function pay(authenticated: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/billing/demo/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, card, ...(authenticated ? { authenticated: true } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; requiresAuthentication?: boolean; redirect?: string; detail?: string };
      if (!res.ok) {
        setError(body.detail ?? "The payment could not be completed.");
      } else if (body.requiresAuthentication) {
        setStep("authenticate");
      } else if (body.ok && body.redirect) {
        setStep("done");
        setRedirect(body.redirect);
        window.setTimeout(() => window.location.assign(body.redirect!), 1400);
      }
    } catch {
      setError("The request could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
        <DrawCheck size={48} />
        <p className="text-sm font-medium text-zinc-50">Payment received</p>
        <p className="text-xs text-zinc-400">Taking you back to your workspace.</p>
        {redirect && (
          <Link href={redirect} className="text-xs text-zinc-300 underline decoration-white/20 underline-offset-4 hover:text-white">
            Continue now
          </Link>
        )}
      </div>
    );
  }

  if (step === "authenticate") {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-white/[0.02] p-4">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-zinc-300" aria-hidden="true" />
          <div className="text-xs leading-5">
            <p className="font-medium text-zinc-100">Your bank asks you to confirm this payment</p>
            <p className="mt-0.5 text-zinc-400">This simulates a 3-D Secure step. Confirm to pay {amount}.</p>
          </div>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setStep("card")} disabled={busy}>
            Back
          </Button>
          <Button className="flex-1" loading={busy} onClick={() => pay(true)}>
            Confirm and pay {amount}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void pay(false);
      }}
    >
      <div>
        <label htmlFor="demo-card" className="text-xs text-zinc-400">
          Card number
        </label>
        <input
          id="demo-card"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          required
          value={card}
          onChange={(e) => setCard(formatCardNumber(e.target.value))}
          placeholder="4242 4242 4242 4242"
          className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm tracking-wider text-zinc-50 placeholder:text-zinc-600 focus:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        />
      </div>

      <fieldset>
        <legend className="mb-2 text-xs text-zinc-500">Test cards (click to fill)</legend>
        <ul className="space-y-1">
          {cards.map((c) => (
            <li key={c.number}>
              <button
                type="button"
                onClick={() => setCard(c.number)}
                className={cn(
                  "press flex w-full items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-left text-xs transition-colors",
                  card === c.number ? "border-white/25 bg-white/[0.06] text-zinc-100" : "border-transparent text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                )}
              >
                <span className="font-mono tabular-nums">{c.number}</span>
                <span className="truncate text-zinc-500">{c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </fieldset>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="flex items-center gap-2">
        <Link href={cancelUrl} className={cn(buttonBase, buttonVariants.ghost, buttonSizes.md)}>
          Cancel
        </Link>
        <Button type="submit" className="flex-1" loading={busy} disabled={card.replace(/\D/g, "").length < 12}>
          Pay {amount}
        </Button>
      </div>
    </form>
  );
}
