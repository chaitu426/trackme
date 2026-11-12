import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { GlyphField } from "@trackme/landing";
import { DEMO_CARDS, demoAllowed, demoSecret, priceFor, verifySession } from "@trackme/billing";
import { LogoMark } from "@/components/brand/logo-mark";
import { Card } from "@/components/ui/card";
import { buttonBase, buttonSizes, buttonVariants } from "@/components/ui/button";
import { formatPrice } from "@/lib/billing-view";
import { isDemoBilling, safeReturnPath } from "@/lib/billing";
import { cn } from "@/lib/utils";
import { DemoCheckoutForm } from "./demo-checkout-form";

export const metadata: Metadata = { title: "Demo checkout", robots: { index: false, follow: false } };

// Depends on the request (the signed session) and on runtime configuration, so it is never built ahead of time.
export const dynamic = "force-dynamic";

/**
 * The demo gateway's hosted checkout: what a real provider's payment page would be. It checks the signed session, shows the
 * order, and takes a test card. The notice is deliberate: nobody should mistake this for a real payment.
 */
export default async function DemoCheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { session: token } = await searchParams;
  // A page that exists only for the demo gateway: anywhere the demo is off or not allowed (production by default), it is not found.
  if (!isDemoBilling() || !demoAllowed()) notFound();
  const session = typeof token === "string" ? verifySession(demoSecret(), token, new Date()) : null;

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-zinc-100 antialiased">
      <div className="pointer-events-none absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,black,transparent)]" aria-hidden="true">
        <GlyphField variant="gauge" cell={10} strength={0.4} className="absolute inset-0 h-full w-full" />
      </div>

      <header className="relative flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] px-4 sm:px-6">
        <span className="flex items-center gap-2 text-base font-medium leading-none text-zinc-50">
          <LogoMark />
          TrackMe
        </span>
        <span className="rounded-md border border-warn/40 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-warn">Demo payments</span>
      </header>

      <main className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        {session ? (
          <Card className="space-y-6 bg-card/95 p-6 backdrop-blur-[2px]">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500">Order</p>
              <div className="mt-2 flex items-baseline justify-between gap-4">
                <h1 className="text-base font-medium text-zinc-50">TrackMe Pro, {session.interval === "year" ? "yearly" : "monthly"}</h1>
                <p className="font-mono text-lg tabular-nums text-zinc-50">{formatPrice(priceFor(session.interval).amountMinor, priceFor(session.interval).currency)}</p>
              </div>
              <p className="mt-1 text-xs text-zinc-500">Billed {session.interval === "year" ? "once a year" : "every month"}. Cancel any time from the billing page.</p>
            </div>

            <DemoCheckoutForm
              session={token as string}
              cancelUrl={safeReturnPath(session.cancelUrl, "/")}
              cards={DEMO_CARDS.map((c) => ({ number: c.number, label: c.label }))}
              amount={formatPrice(priceFor(session.interval).amountMinor, priceFor(session.interval).currency)}
            />
          </Card>
        ) : (
          <Card className="space-y-3 p-6 text-center">
            <h1 className="text-sm font-medium text-zinc-50">This checkout has expired</h1>
            <p className="text-xs leading-5 text-zinc-400">Checkout links last thirty minutes. Go back to the billing page and start again.</p>
            <div>
              <Link href="/" className={cn(buttonBase, buttonVariants.secondary, buttonSizes.sm)}>
                Back to TrackMe
              </Link>
            </div>
          </Card>
        )}
        <p className="mt-6 text-center text-[11px] leading-5 text-zinc-600">This is a demonstration gateway. No card is read, charged or stored.</p>
      </main>
    </div>
  );
}
