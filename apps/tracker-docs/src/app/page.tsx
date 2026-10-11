import type { Metadata } from "next";
import { Landing } from "@trackme/landing";
import { DASHBOARD_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "TrackMe — Cookieless Web Analytics" },
  description:
    "Privacy-first web analytics for product and growth teams. Understand your traffic without cookies or invasive tracking.",
};

export default function HomePage() {
  // Without a dashboard URL the call to action goes to the quickstart, so the page
  // never links to somewhere that does not exist.
  const dashboard = DASHBOARD_URL.replace(/\/$/, "");

  return (
    <Landing
      links={{
        docs: "/docs",
        quickstart: "/docs/quickstart",
        frameworks: "/docs/frameworks",
        getStarted: dashboard ? `${dashboard}/signup` : "/docs/quickstart",
        ...(dashboard ? { signIn: `${dashboard}/login`, privacy: `${dashboard}/legal/privacy` } : {}),
      }}
    />
  );
}
