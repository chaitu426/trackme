import {
  OPEN_STATE,
  transition,
  type ErrorAction,
  type ErrorStatus,
  type ErrorStatusState,
  type ResolveMode,
} from "@trackme/contracts";
import { and, db, eq, siteErrorStatus, inArray } from "@trackme/db";

export type StoredErrorStatus = ErrorStatusState & { groupId: string };

const asStatus = (value: string): ErrorStatus => (value === "resolved" || value === "ignored" ? value : "open");
const asMode = (value: string): ResolveMode => (value === "next_release" ? "next_release" : "now");

/** Every issue of a site that someone has resolved or ignored. An issue with no row is open. One indexed read. */
export async function loadErrorStatuses(siteId: string): Promise<StoredErrorStatus[]> {
  const rows = await db.select().from(siteErrorStatus).where(eq(siteErrorStatus.siteId, siteId));
  return rows.map((row) => ({
    groupId: row.groupId,
    status: asStatus(row.status),
    mode: asMode(row.mode),
    resolvedAt: row.resolvedAt,
    knownReleases: row.knownReleases,
    regressedAt: row.regressedAt,
    regressedIn: row.regressedIn,
  }));
}

/** The status of the given issues, as a map; absent ids are open. */
export async function loadStatusesFor(siteId: string, groupIds: string[]): Promise<Map<string, StoredErrorStatus>> {
  if (groupIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(siteErrorStatus)
    .where(and(eq(siteErrorStatus.siteId, siteId), inArray(siteErrorStatus.groupId, groupIds)));
  return new Map(
    rows.map((row) => [
      row.groupId,
      {
        groupId: row.groupId,
        status: asStatus(row.status),
        mode: asMode(row.mode),
        resolvedAt: row.resolvedAt,
        knownReleases: row.knownReleases,
        regressedAt: row.regressedAt,
        regressedIn: row.regressedIn,
      },
    ])
  );
}

/** Saves the result of an action (see transition in contracts) for one issue. */
export async function applyErrorAction(params: {
  siteId: string;
  groupId: string;
  action: ErrorAction;
  userId: string | null;
  releasesSeen: string[];
}): Promise<ErrorStatusState> {
  const state = params.action === "reopen" ? { ...OPEN_STATE } : transition(params.action, new Date(), params.releasesSeen);
  const values = {
    status: state.status,
    mode: state.mode,
    resolvedAt: state.resolvedAt,
    knownReleases: state.knownReleases,
    regressedAt: state.regressedAt,
    regressedIn: state.regressedIn,
    updatedBy: params.userId,
    updatedAt: new Date(),
  };
  await db
    .insert(siteErrorStatus)
    .values({ siteId: params.siteId, groupId: params.groupId, ...values })
    .onConflictDoUpdate({ target: [siteErrorStatus.siteId, siteErrorStatus.groupId], set: values });
  return state;
}
