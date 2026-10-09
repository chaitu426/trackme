import { Landing } from "@trackme/landing";

/**
 * The public landing page. It is the same component the docs site renders, so the
 * two stay identical; only the links differ.
 *
 * Set NEXT_PUBLIC_DOCS_URL to the docs site's origin (for example
 * https://docs.example.com). It defaults to the local dev port.
 */
const docsOrigin = (
  process.env.NEXT_PUBLIC_DOCS_URL ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3002")
).replace(/\/$/, "");

export default function MarketingPage() {
  return (
    <Landing
      links={{
        docs: `${docsOrigin}/docs`,
        quickstart: `${docsOrigin}/docs/quickstart`,
        frameworks: `${docsOrigin}/docs/frameworks`,
        reference: `${docsOrigin}/docs/reference/tracker-api`,
        selfHosting: `${docsOrigin}/docs/operate/self-hosting`,
        signIn: "/login",
        getStarted: "/signup",
        privacy: "/legal/privacy",
      }}
    />
  );
}
