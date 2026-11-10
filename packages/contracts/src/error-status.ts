/**
 * Rules for the life of an error issue, shared by the dashboard (what the buttons do) and the scheduled worker
 * (when a resolved issue comes back). Pure functions: no database, no clock except the one passed in.
 */

export const ERROR_STATUSES = ["open", "resolved", "ignored"] as const;
export type ErrorStatus = (typeof ERROR_STATUSES)[number];
export type ResolveMode = "now" | "next_release";
export type ErrorAction = "resolve" | "resolve_next_release" | "ignore" | "reopen";
export type StatusFilter = ErrorStatus | "all";

export const ERROR_ACTIONS: readonly ErrorAction[] = ["resolve", "resolve_next_release", "ignore", "reopen"];

export interface ErrorStatusState {
  status: ErrorStatus;
  mode: ResolveMode;
  resolvedAt: Date | null;
  /** Releases the issue had been seen in when it was resolved. */
  knownReleases: string[];
  regressedAt: Date | null;
  regressedIn: string | null;
}

export const OPEN_STATE: ErrorStatusState = {
  status: "open",
  mode: "now",
  resolvedAt: null,
  knownReleases: [],
  regressedAt: null,
  regressedIn: null,
};

/**
 * The state an action leads to. `releasesSeen` is every release the issue has appeared in so far; it only matters
 * for "resolve in next release", where those builds may keep raising the error without it counting as a comeback.
 */
export function transition(action: ErrorAction, now: Date, releasesSeen: string[]): ErrorStatusState {
  switch (action) {
    case "resolve":
      return { ...OPEN_STATE, status: "resolved", resolvedAt: now };
    case "resolve_next_release":
      return {
        ...OPEN_STATE,
        status: "resolved",
        mode: "next_release",
        resolvedAt: now,
        knownReleases: [...new Set(releasesSeen.filter(Boolean))],
      };
    case "ignore":
      return { ...OPEN_STATE, status: "ignored" };
    case "reopen":
      return { ...OPEN_STATE };
  }
}

/** Which issue ids a status filter keeps, as the two list-query inputs. Open means "not resolved and not ignored". */
export function groupFilter(
  rows: Array<{ groupId: string; status: ErrorStatus }>,
  filter: StatusFilter
): { onlyGroupIds?: string[]; excludeGroupIds?: string[] } {
  if (filter === "all") return {};
  if (filter === "open") {
    return { excludeGroupIds: rows.filter((r) => r.status !== "open").map((r) => r.groupId) };
  }
  return { onlyGroupIds: rows.filter((r) => r.status === filter).map((r) => r.groupId) };
}

/**
 * Has a resolved issue come back? `seen` is where it has appeared since it was resolved: one entry per release with
 * the time it was last seen. Returns the release that brought it back ("" when events carry no release), or null.
 *
 *  - resolved now: any occurrence after the resolve time is a regression.
 *  - resolved in next release: builds that already had the error may keep raising it; only a release that was not
 *    known at resolve time counts. Events with no release cannot be told apart, so they never reopen it.
 */
export function findRegression(
  state: Pick<ErrorStatusState, "status" | "mode" | "resolvedAt" | "knownReleases">,
  seen: Array<{ release: string; lastSeen: Date }>
): { release: string } | null {
  if (state.status !== "resolved" || !state.resolvedAt) return null;
  const after = seen.filter((s) => s.lastSeen.getTime() > state.resolvedAt!.getTime());
  if (state.mode === "now") {
    const first = after[0];
    return first ? { release: first.release } : null;
  }
  const known = new Set(state.knownReleases);
  const fresh = after.find((s) => s.release !== "" && !known.has(s.release));
  return fresh ? { release: fresh.release } : null;
}
