import { Landing, type LandingViewer, type PricingProps } from "@trackme/landing";
import { env } from "@trackme/config";
import { priceFor } from "@trackme/billing";
import { companyPlan } from "@/lib/billing";
import { formatPrice, yearlySavingPercent } from "@/lib/billing-view";
import { planCards } from "@/lib/plan-copy";
import { getCurrentUser } from "@/lib/auth";
import { listUserWorkspaces } from "@/lib/tenancy";
import { resolveTrackerScriptUrl } from "@/lib/tracker-url";

/**
 * The public landing page. It is the same component the docs site renders, so the
 * two stay identical; only the links differ.
 *
 * Set NEXT_PUBLIC_DOCS_URL to the docs site's origin (for example
 * https://docs.example.com). It defaults to the local dev port.
 */
const configuredDocsOrigin = process.env.NEXT_PUBLIC_DOCS_URL;
if (process.env.NODE_ENV === "production" && !configuredDocsOrigin) {
  throw new Error("NEXT_PUBLIC_DOCS_URL must be set to the public docs-site origin for production builds.");
}

const docsOrigin = (configuredDocsOrigin ?? "http://localhost:3002").replace(/\/+$/, "");

// The install snippet shows the real addresses. Anything pointing at this machine is left
// out, so a misconfigured build shows placeholders instead of "localhost" to visitors.
const scriptUrl = resolveTrackerScriptUrl();
const endpoint = `${env.INGESTION_URL.replace(/\/+$/, "")}/v1/batch`;
const isLocal = (url: string) => /localhost|127\.0\.0\.1/.test(url);

async function resolveViewer(): Promise<{ viewer: LandingViewer; plan: "free" | "pro"; billingHref: string | undefined } | undefined> {
  try {
    const user = await getCurrentUser();
    if (!user) return undefined;

    const [workspace] = await listUserWorkspaces(user.id);
    // A failed plan lookup must not hide the page: the visitor simply sees the public plans.
    const plan = workspace ? await companyPlan(workspace.companyId).catch(() => "free" as const) : "free";
    return {
      viewer: {
        name: user.name?.trim() || user.email.split("@")[0] || "there",
        href: workspace ? `/${workspace.slug}/overview` : "/onboarding",
        cta: workspace ? "Go to workspace" : "Finish setup",
      },
      plan,
      billingHref: workspace ? `/${workspace.slug}/settings/billing` : undefined,
    };
  } catch {
    // The public page still renders if the session store or database is briefly down.
    return undefined;
  }
}

/** The plans as the landing page shows them, built from the same table and prices the app enforces and charges. */
function pricingFor(visitor: Awaited<ReturnType<typeof resolveViewer>>): PricingProps {
  const month = priceFor("month");
  const year = priceFor("year");
  const money = (minor: number) => formatPrice(minor, month.currency);
  const [free, pro] = planCards();
  return {
    plans: [
      { ...free!, monthly: money(0), yearlyPerMonth: money(0), yearlyTotal: money(0) },
      { ...pro!, monthly: money(month.amountMinor), yearlyPerMonth: money(Math.round(year.amountMinor / 12)), yearlyTotal: money(year.amountMinor) },
    ],
    yearlySaving: yearlySavingPercent(month.amountMinor, year.amountMinor),
    freeHref: "/signup",
    proHref: visitor?.billingHref ?? "/signup",
    currentPlan: visitor?.plan,
    manageHref: visitor?.billingHref,
  };
}

export default async function MarketingPage() {
  const visitor = await resolveViewer();
  const viewer = visitor?.viewer;

  return (
    <Landing
      viewer={viewer}
      pricing={pricingFor(visitor)}
      {...(isLocal(scriptUrl) || isLocal(endpoint) ? {} : { snippet: { scriptUrl, endpoint } })}
      links={{
        docs: `${docsOrigin}/docs`,
        quickstart: `${docsOrigin}/docs/quickstart`,
        frameworks: `${docsOrigin}/docs/frameworks`,
        signIn: "/login",
        getStarted: "/signup",
        privacy: "/legal/privacy",
      }}
    />
  );
}
