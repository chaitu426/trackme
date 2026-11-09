import { NextRequest, NextResponse } from "next/server";
import { and, db, eq, goals } from "@trackme/db";
import { getUserSummary, getUserTimelinePage } from "@trackme/analytics";
import { requireSiteAccess } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";

const PAGE_SIZE = 40;
const list = (value: string | null) => (value ? value.split(",").map((part) => part.trim()).filter(Boolean).slice(0, 8) : undefined);

/** The summary, with the first day the person did each of the site's event goals, named after the goal ("Signup"). */
async function summaryWithMilestones(siteId: string, userId: string) {
  const eventGoals = await db
    .select({ name: goals.name, eventName: goals.eventName })
    .from(goals)
    .where(and(eq(goals.siteId, siteId), eq(goals.enabled, true), eq(goals.type, "custom_event")))
    .catch(() => []);
  const events = eventGoals.flatMap((g) => (g.eventName ? [g.eventName] : []));
  const summary = await getUserSummary(siteId, userId, undefined, events);
  const nameOf = new Map(eventGoals.map((g) => [g.eventName ?? "", g.name]));
  return { ...summary, milestones: summary.milestones.map((m) => ({ ...m, label: nameOf.get(m.event) ?? m.event })) };
}

/**
 * One page of a person's timeline, newest first, plus (on the first page) the header summary. Kinds and severities are
 * comma-separated filters; the cursor comes from the previous page. Needs read access to the site.
 */
async function handleGet(
  request: NextRequest,
  props: { params: Promise<{ siteId: string; distinctId: string }> }
) {
  try {
    const { siteId, distinctId } = await props.params;
    const { site } = await requireSiteAccess(request, siteId, "analytics:read");
    const userId = decodeURIComponent(distinctId);
    const search = request.nextUrl.searchParams;
    const cursor = search.get("cursor") ?? undefined;

    const [page, summary] = await Promise.all([
      getUserTimelinePage({
        siteId: site.id,
        userId,
        kinds: list(search.get("kinds")),
        severities: list(search.get("severity")),
        cursor,
        limit: PAGE_SIZE,
      }),
      cursor ? Promise.resolve(null) : summaryWithMilestones(site.id, userId),
    ]);

    return NextResponse.json({ ...page, summary }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

export const GET = timedRoute("user_timeline", handleGet);
