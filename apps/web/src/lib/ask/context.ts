import { pageLabelFor } from "@/lib/nav";

export interface AskContext {
  /** The part of the app the person is in, which decides the suggestions. */
  area: "payments" | "errors" | "releases" | "traffic" | "people" | "settings" | "general";
  /** The page's name for the context chip, or null when it has none. */
  page: string | null;
  suggestions: string[];
}

const BY_AREA: Record<AskContext["area"], string[]> = {
  payments: ["Why did the payment success rate drop yesterday?", "Which error costs us the most at checkout?", "Where do visitors drop off in checkout?"],
  errors: ["Which error costs us the most at checkout?", "How is the 1.2.0 release doing?", "Which errors are new this week?"],
  releases: ["How is the 1.2.0 release doing, should we roll back?", "Which error costs us the most at checkout?", "Did conversion change after the last deploy?"],
  traffic: ["How was our traffic over the last 30 days?", "Where do visitors drop off in checkout?", "Which pages are most popular?"],
  people: ["Who are our most active users this month?", "Which users hit errors at checkout?", "How many users came back this week?"],
  settings: ["What can you read for me?", "How was our traffic over the last 30 days?", "Why did the payment success rate drop yesterday?"],
  general: ["How was our traffic over the last 30 days?", "Why did the payment success rate drop yesterday?", "Which error costs us the most at checkout?"],
};

/** What part of the app a path is in, from the path alone. */
export function areaOf(pathname: string, workspaceSlug: string): AskContext["area"] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== workspaceSlug) return "general";
  if (parts[1] === "settings") return "settings";
  if (parts[1] === "overview") return "traffic";
  if (parts[1] !== "sites") return "general";
  const section = parts[3] ?? "";
  if (section === "payments") return "payments";
  if (section === "errors") return "errors";
  if (section === "releases") return "releases";
  if (section === "people") return "people";
  if (section === "settings") return "settings";
  return "traffic";
}

export function askContext(pathname: string, workspaceSlug: string): AskContext {
  const area = areaOf(pathname, workspaceSlug);
  return { area, page: pageLabelFor(pathname, workspaceSlug) ?? null, suggestions: BY_AREA[area] };
}
