import { Landing } from "@trackme/landing";

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

export default function MarketingPage() {
  return (
    <Landing
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
