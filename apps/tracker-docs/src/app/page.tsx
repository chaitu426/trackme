import { Landing } from "@trackme/landing";
import { DASHBOARD_URL } from "@/lib/site";

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
        reference: "/docs/reference/tracker-api",
        selfHosting: "/docs/operate/self-hosting",
        getStarted: dashboard ? `${dashboard}/signup` : "/docs/quickstart",
        ...(dashboard ? { signIn: `${dashboard}/login`, privacy: `${dashboard}/legal/privacy` } : {}),
      }}
    />
  );
}
