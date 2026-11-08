import { Landing, type LandingViewer } from "@trackme/landing";
import { env } from "@trackme/config";
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

async function resolveViewer(): Promise<LandingViewer | undefined> {
  try {
    const user = await getCurrentUser();
    if (!user) return undefined;

    const [workspace] = await listUserWorkspaces(user.id);
    return {
      name: user.name?.trim() || user.email.split("@")[0] || "there",
      href: workspace ? `/${workspace.slug}/overview` : "/onboarding",
      cta: workspace ? "Go to workspace" : "Finish setup",
    };
  } catch {
    // The public page still renders if the session store or database is briefly down.
    return undefined;
  }
}

export default async function MarketingPage() {
  const viewer = await resolveViewer();

  return (
    <Landing
      viewer={viewer}
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
